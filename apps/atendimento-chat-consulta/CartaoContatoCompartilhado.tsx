import {useEffect,useId,useRef,useState} from 'react';
import {ContactRound,MessageSquare,UserRoundPlus} from 'lucide-react';
import {Button} from '../../src/components/ui/button';
import {normalizarTelefoneContato} from '../../src/lib/atendimento/operacao-telefone-contato';
import NovoContatoOperacao from './NovoContatoOperacao';
import {Escolha} from './operacao-ui';
import {formatarTelefoneContatoDigitado} from './telefone-contato-mascara';
import {ErroOperacao,limparTextoOperacao,mensagemErroOperacao,type ClienteOperacao,type ContatoOperacao,type ConversaOperacao,type CriacaoContatoOperacao,type ContatoCompartilhadoOperacao} from './operacao-api';

const textoCampo=(texto:string,limite:number)=>limparTextoOperacao(texto,limite).replace(/[\r\n\t]/g,' ').trim();
function numeroValido(numero:string){try{return '+'+normalizarTelefoneContato(numero);}catch{return '';}}
const numeroCadastro=(numero:string|null)=>numeroValido(numero?.startsWith('+')?numero:'+'+(numero??''));
function telefoneVisivel(numero:string){const normalizado=numeroValido(numero);return normalizado?(formatarTelefoneContatoDigitado(normalizado)??normalizado):numero;}

/** O cartão usa apenas telefones declarados no compartilhamento. Nunca deriva um número do wa_id. */
export default function CartaoContatoCompartilhado({contato,cliente,permissoes,abrirConversa,falhar}:{contato:ContatoCompartilhadoOperacao;cliente:ClienteOperacao;permissoes:readonly string[];abrirConversa:(conversa:ConversaOperacao)=>void|Promise<void>;falhar:(erro:unknown)=>void}){
 const id=useId(),validos=[...new Set(contato.telefones.map(t=>numeroValido(t.numero)).filter(Boolean))];
 const [escolhido,setEscolhido]=useState(''),[criando,setCriando]=useState(false),[ocupado,setOcupado]=useState(false),[incerto,setIncerto]=useState(false),[erro,setErro]=useState(''),[aviso,setAviso]=useState('');
 const numero=validos.length===1?validos[0]:validos.includes(escolhido)?escolhido:'';
 const podeSalvar=permissoes.includes('contatos.adicionar')&&permissoes.includes('contatos.visualizar'),podeIniciar=podeSalvar&&['consultar','conversas.visualizar','conversas.adicionar','mensagens.visualizar','mensagens.adicionar'].every(p=>permissoes.includes(p));
 const vivo=useRef(true),autorizado=useRef(podeIniciar),emCurso=useRef(false),criacao=useRef<CriacaoContatoOperacao|null>(null),salvo=useRef<ContatoOperacao|null>(null),inicio=useRef<{contatoId:string;versaoContato:number;idempotencia:string}|null>(null);
 autorizado.current=podeIniciar;
 useEffect(()=>{vivo.current=true;return()=>{vivo.current=false;};},[]);
 const nome=textoCampo(contato.nome,200)||textoCampo(contato.empresa,200)||'Contato compartilhado',email=contato.emails.find(e=>e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))??'',descricao=textoCampo(contato.empresa,200);
 async function iniciar(){
  if(!numero||!autorizado.current||emCurso.current)return;
  emCurso.current=true;setOcupado(true);setErro('');setAviso('');
  try{
   if(!salvo.current){criacao.current??={nome,telefone:numero,ddi:'55',email,descricao,classificacao:'lead',idempotencia:crypto.randomUUID()};const r=await cliente.criarContato(criacao.current);if(numeroCadastro(r.contato.telefone)!==numero)throw new ErroOperacao('RESULTADO_INCERTO');salvo.current=r.contato;}
   if(!vivo.current||!autorizado.current)return;
   const c=salvo.current;inicio.current??={contatoId:c.id,versaoContato:c.versao??1,idempotencia:crypto.randomUUID()};
   const r=await cliente.iniciarConversaContato(inicio.current);
   if(!vivo.current||!autorizado.current)return;
   setIncerto(false);inicio.current=null;await abrirConversa(r.conversa);
  }catch(e){if(vivo.current){if(e instanceof ErroOperacao&&e.codigo==='LOGIN')falhar(e);else{const indefinido=e instanceof ErroOperacao&&e.codigo==='RESULTADO_INCERTO';setIncerto(indefinido);if(!indefinido){criacao.current=null;inicio.current=null;salvo.current=null;}setErro(indefinido?'A confirmação não chegou. Clique em Conferir conversa para verificar a mesma solicitação.':mensagemErroOperacao(e));}}}
  finally{emCurso.current=false;if(vivo.current)setOcupado(false);}
 }
 function escolher(valor:string){if(ocupado||incerto)return;setEscolhido(valor);criacao.current=null;salvo.current=null;inicio.current=null;setErro('');setAviso('');}
 return <section className="contato-compartilhado" aria-label={'Contato compartilhado: '+nome}>
  <div className="contato-compartilhado-identificacao"><span className="contato-compartilhado-avatar" aria-hidden="true"><ContactRound size={24}/></span><div><strong>{nome}</strong>{contato.empresa&&contato.empresa!==contato.nome&&<span className="muted">{contato.empresa}</span>}</div></div>
  {contato.telefones.length>0&&<ul className="contato-compartilhado-telefones">{contato.telefones.map((t,i)=><li key={i}><span>{telefoneVisivel(t.numero)}</span>{t.tipo&&<small className="muted">{t.tipo}</small>}</li>)}</ul>}
  {validos.length>1&&<label htmlFor={id}>Telefone para salvar ou conversar<Escolha id={id} label={'Telefone do contato '+nome} value={escolhido||'__escolha__'} options={[{valor:'__escolha__',rotulo:'Escolha um telefone'},...validos.map(n=>({valor:n,rotulo:telefoneVisivel(n)}))]} disabled={ocupado||incerto} onChange={v=>escolher(v==='__escolha__'?'':v)}/></label>}
  {!validos.length&&<p className="muted">Este contato não tem telefone válido para salvar ou iniciar uma conversa. Confira o número com o cliente.</p>}
  {!podeSalvar?<p className="muted">Sua conta não tem permissão para salvar contatos ou iniciar conversas.</p>:!podeIniciar&&<p className="muted">Iniciar conversa exige as permissões de adicionar conversas e mensagens.</p>}
  <div className="contato-compartilhado-acoes"><Button type="button" variant="outline" size="sm" className="btn" disabled={!podeSalvar||!numero||ocupado||incerto} onClick={()=>setCriando(true)}><UserRoundPlus size={15} aria-hidden="true"/>Salvar contato</Button><Button type="button" variant="outline" size="sm" className="btn" disabled={!podeIniciar||!numero||ocupado} aria-busy={ocupado} onClick={()=>void iniciar()}><MessageSquare size={15} aria-hidden="true"/>{ocupado?'Abrindo…':incerto?'Conferir conversa':'Iniciar conversa'}</Button></div>
  {erro&&<p className="contato-compartilhado-erro" role="alert">{erro}</p>}{aviso&&<p className="muted" role="status">{aviso}</p>}
  {criando&&podeSalvar&&<NovoContatoOperacao podeSalvar={podeSalvar} dadosIniciais={{nome,telefone:formatarTelefoneContatoDigitado(numero)??numero,email,descricao}} cliente={cliente} fechar={()=>setCriando(false)} falhar={falhar} salvo={(c,reutilizado)=>{salvo.current=numeroCadastro(c.telefone)===numero?c:null;setAviso(reutilizado?'Este telefone já tem cadastro. Os dados existentes foram preservados.':'Contato salvo. Você pode iniciar a conversa quando precisar.');}}/>}
 </section>;
}
