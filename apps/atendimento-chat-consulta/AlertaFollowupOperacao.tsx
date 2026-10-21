import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {Bell,Check,Clock3,X} from 'lucide-react';
import {Button} from '../../src/components/ui/button';
import {Input} from '../../src/components/ui/input';
import {BotaoRemoverItem} from '../../src/components/remover-item';
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '../../src/components/ui/dialog';
import {ErroOperacao,limparTextoOperacao,mensagemErroOperacao,type ClienteOperacao,type LembreteFollowupOperacao} from './operacao-api';
import {agoraLembrete,dataHoraLocalLembrete,DIA_LEMBRETE,horarioLembreteVisivel,lembreteAtrasado,MINUTO_LEMBRETE,sugerirHorarioLembrete,validarHorarioLembrete} from './lembrete-followup-horario';
import './AlertaFollowupOperacao.css';

type Props={podeAgendar?:boolean;podeEditar?:boolean;podeExcluir?:boolean;conversaId:string;nomeContato:string;lembrete:LembreteFollowupOperacao|null;cliente:ClienteOperacao;fechar:()=>void;salvo:(lembrete:LembreteFollowupOperacao|null)=>void;falhar:(erro:unknown)=>void};
type Pedido=Parameters<ClienteOperacao['alterarLembrete']>[1];
const atalhos=[{horas:1,nome:'1 hora'},{horas:3,nome:'3 horas'},{horas:24,nome:'1 dia'},{horas:72,nome:'3 dias'},{horas:168,nome:'7 dias'}];

/** O contexto da conversa delimita o formulário e as respostas assíncronas. */
export default function AlertaFollowupOperacao(props:Props){return <FormularioAlertaFollowup key={props.conversaId} {...props}/>;}
function FormularioAlertaFollowup({conversaId,nomeContato,lembrete,cliente,fechar,salvo,falhar,podeAgendar=false,podeEditar=false,podeExcluir=false}:Props){
 const [focoOrigem]=useState(()=>document.activeElement instanceof HTMLElement?document.activeElement:null);
 const id=useId(),base=useRef(lembrete),inicial=useRef(lembrete?dataHoraLocalLembrete(lembrete.agendadoPara):'');
 const [horario,setHorario]=useState(inicial.current),[descricao,setDescricao]=useState(lembrete?.descricao??''),[agora,setAgora]=useState(()=>performance.now()),[ocupado,setOcupado]=useState(false),[incerto,setIncerto]=useState(false),[bloqueado,setBloqueado]=useState(false),[erro,setErro]=useState(''),[visitado,setVisitado]=useState(false),[confirmarCancelamento,setConfirmarCancelamento]=useState(false);
 const emCurso=useRef(false),pedido=useRef<Pedido|null>(null),vivo=useRef(false),geracao=useRef(0),retornos=useRef({fechar,salvo,falhar});retornos.current={fechar,salvo,falhar};
 useEffect(()=>{const epoca=geracao.current;vivo.current=true;return()=>{vivo.current=false;geracao.current=epoca+1;};},[cliente]);
 useEffect(()=>{const timer=setInterval(()=>setAgora(performance.now()),15000);return()=>clearInterval(timer);},[]);
 const referencia=agoraLembrete(lembrete,agora),validacao=validarHorarioLembrete(horario,referencia),horarioAlterado=horario!==inicial.current,descricaoAlterada=descricao!==(base.current?.descricao??''),alterado=horarioAlterado||descricaoAlterada,exigeHorario=!base.current||horarioAlterado,travado=ocupado||incerto||bloqueado;
 const podeAlterarFormulario=base.current?podeEditar:podeAgendar;
 const acaoPermitida=(acao:Pedido['acao'])=>acao==='agendar'?podeAgendar:acao==='cancelar'?podeExcluir:podeEditar;
 function alterar(valor:string){if(travado||!podeAlterarFormulario)return;setHorario(valor);pedido.current=null;setErro('');}
 function alterarDescricao(valor:string){if(travado||!podeAlterarFormulario)return;setDescricao(limparTextoOperacao(valor,1000));pedido.current=null;setErro('');}
 async function executar(acao?:Pedido['acao']){
  if(emCurso.current||bloqueado||incerto&&acao||acao&&!acaoPermitida(acao))return;
  if(acao){
   const dados:Pedido={acao,idempotencia:crypto.randomUUID(),versao:base.current?.versao??0,...(base.current?{lembreteId:base.current.id}:{})};
   if(acao==='atualizar'||(acao==='agendar'||acao==='reagendar')&&descricaoAlterada)dados.descricao=descricao;
   if(acao==='agendar'||acao==='reagendar'){
    const valor=validarHorarioLembrete(horario,agoraLembrete(lembrete));setVisitado(true);
    if(!valor.instante){setErro(valor.erro);return;}dados.agendadoPara=valor.instante;
   }else if(!base.current)return;
   pedido.current=dados;
  }
  const dados=pedido.current;if(!dados)return;if(!acaoPermitida(dados.acao)){setErro('Sua conta não tem mais permissão para esta alteração.');return;}
  const epoca=geracao.current,vigente=()=>vivo.current&&epoca===geracao.current;
  emCurso.current=true;setOcupado(true);setErro('');setConfirmarCancelamento(false);
  try{
   const resposta=await cliente.alterarLembrete(conversaId,dados);if(!vigente())return;
   pedido.current=null;setIncerto(false);retornos.current.salvo(resposta.lembrete);retornos.current.fechar();
  }catch(e){if(vigente()){
   if(e instanceof ErroOperacao&&['LOGIN','PERMISSAO'].includes(e.codigo)){setBloqueado(true);setIncerto(false);pedido.current=null;setErro(mensagemErroOperacao(e));retornos.current.falhar(e);}
   else if(e instanceof ErroOperacao&&e.codigo==='CONFLITO'){setBloqueado(true);pedido.current=null;setIncerto(false);setErro('Este agendamento mudou. Feche e abra o alerta para conferir os dados atuais.');}
   else{const indefinido=!(e instanceof ErroOperacao)||e.codigo==='RESULTADO_INCERTO';setIncerto(indefinido);if(!indefinido)pedido.current=null;setErro(indefinido?'A confirmação não chegou. Confira a mesma solicitação antes de alterar o alerta.':mensagemErroOperacao(e));}
  }}finally{emCurso.current=false;if(vigente())setOcupado(false);}
 }
 function agendar(evento:FormEvent){evento.preventDefault();if(podeAlterarFormulario&&!travado&&(!base.current||alterado))void executar(base.current?(horarioAlterado?'reagendar':'atualizar'):'agendar');}
 return <Dialog open alterado={alterado&&!bloqueado} protegerAlteracoes={!ocupado&&!incerto} onOpenChange={aberto=>{if(!aberto&&!ocupado&&!incerto)fechar();}}><DialogContent className="modal modal-lembrete-followup" showCloseButton={false} finalFocus={()=>focoOrigem?.isConnected?focoOrigem:false}>
  <DialogHeader className="lembrete-followup-cabecalho"><DialogTitle><Bell size={20} aria-hidden="true"/>Alerta de follow-up</DialogTitle><DialogClose className="close-icon" aria-label="Fechar alerta de follow-up" disabled={ocupado||incerto}><X size={20}/></DialogClose></DialogHeader>
  <DialogDescription>Agende um lembrete para retomar esta conversa. Nenhuma mensagem será enviada.</DialogDescription><strong className="lembrete-followup-contato">{nomeContato}</strong>
  {base.current&&<section className="lembrete-followup-atual" aria-label="Agendamento atual"><Clock3 size={18} aria-hidden="true"/><div><strong>{lembreteAtrasado(base.current,agora)?'Alerta atrasado':'Alerta agendado'}</strong><p>{horarioLembreteVisivel(base.current.agendadoPara)} · horário de Brasília</p><small className="muted">Agendado por {base.current.criadoPorNome||'Atendente registrado'}</small></div></section>}
  <form className="operacao-form lembrete-followup-form" onSubmit={agendar}>
   <label htmlFor={id}>Data e hora<Input id={id} className="field" type="datetime-local" step={60} min={exigeHorario?dataHoraLocalLembrete(Math.ceil((referencia+MINUTO_LEMBRETE)/MINUTO_LEMBRETE)*MINUTO_LEMBRETE):undefined} max={exigeHorario?dataHoraLocalLembrete(referencia+365*DIA_LEMBRETE):undefined} maxLength={16} required autoFocus value={horario} disabled={travado||!podeAlterarFormulario} aria-describedby={id+'-ajuda'} aria-invalid={visitado&&exigeHorario&&!validacao.instante} onBlur={()=>setVisitado(true)} onChange={e=>alterar(e.target.value)}/></label>
   <p id={id+'-ajuda'} className="muted">Horário de Brasília. Escolha entre 1 minuto e 365 dias a partir de agora.</p>
   <label htmlFor={id+'-descricao'}>Descrição do alerta<textarea id={id+'-descricao'} className="field lembrete-followup-descricao" rows={3} maxLength={1000} placeholder="O que a equipe deve fazer quando chegar o horário?" value={descricao} disabled={travado||!podeAlterarFormulario} aria-describedby={id+'-descricao-ajuda'} onChange={e=>alterarDescricao(e.target.value)}/></label>
   <p id={id+'-descricao-ajuda'} className="muted">Opcional · {descricao.length}/1000 caracteres. A descrição pode ser alterada sem mudar o horário.</p>
   <div className="lembrete-followup-atalhos" role="group" aria-label="Atalhos de agendamento">{atalhos.map(a=><Button key={a.horas} type="button" variant="outline" size="sm" className="btn" disabled={travado||!podeAlterarFormulario} onClick={()=>alterar(sugerirHorarioLembrete(a.horas,agoraLembrete(lembrete)))}>Em {a.nome}</Button>)}</div>
   {visitado&&exigeHorario&&horario&&!validacao.instante&&!incerto&&!erro&&<p className="lembrete-followup-erro" role="status">{validacao.erro}</p>}
   {erro&&<p className="lembrete-followup-erro" role="alert">{erro}</p>}
   <div className="toolbar lembrete-followup-rodape"><DialogClose type="button" className="btn" disabled={ocupado||incerto}>Fechar</DialogClose>{incerto?<Button type="button" variant="outline" className="btn" disabled={ocupado||bloqueado||!pedido.current||!acaoPermitida(pedido.current.acao)} onClick={()=>void executar()}>{ocupado?'Conferindo…':'Conferir solicitação'}</Button>:podeAlterarFormulario&&<Button type="submit" variant="entrada" className="btn acao-confirmar" disabled={travado||exigeHorario&&!validacao.instante||!!base.current&&!alterado}>{ocupado?'Salvando…':base.current?(descricaoAlterada&&!horarioAlterado?'Salvar descrição':'Reprogramar alerta'):'Agendar alerta'}</Button>}</div>
  </form>
  {base.current&&(podeEditar||podeExcluir)&&<div className="lembrete-followup-acoes">{podeEditar&&<Button type="button" variant="outline" className="btn" disabled={travado} onClick={()=>void executar('concluir')}><Check size={16} aria-hidden="true"/>Concluir alerta</Button>}{podeExcluir&&<BotaoRemoverItem nome="Cancelar agendamento" disabled={travado} onClick={()=>setConfirmarCancelamento(true)}/>}</div>}
  {confirmarCancelamento&&podeExcluir&&<Dialog open protegerAlteracoes={false} onOpenChange={aberto=>{if(!aberto&&!ocupado)setConfirmarCancelamento(false);}}><DialogContent className="modal modal-lembrete-followup" showCloseButton={false}><DialogTitle>Cancelar agendamento?</DialogTitle><DialogDescription>O alerta deixará de chamar a atenção da equipe. O agendamento e as alterações permanecerão no histórico.</DialogDescription><div className="toolbar"><DialogClose type="button" className="btn" disabled={ocupado}>Voltar</DialogClose><BotaoRemoverItem nome="Confirmar cancelamento do agendamento" disabled={ocupado} onClick={()=>void executar('cancelar')}/></div></DialogContent></Dialog>}
 </DialogContent></Dialog>;
}
