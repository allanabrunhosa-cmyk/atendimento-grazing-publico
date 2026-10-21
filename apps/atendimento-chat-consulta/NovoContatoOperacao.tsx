import {useEffect,useRef,useState,type FormEvent} from 'react';
import {X} from 'lucide-react';
import {Button} from '../../src/components/ui/button';
import {Input} from '../../src/components/ui/input';
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '../../src/components/ui/dialog';
import {normalizarTelefoneContato} from '../../src/lib/atendimento/operacao-telefone-contato';
import CampoTelefoneContato from './CampoTelefoneContato';
import {Escolha} from './operacao-ui';
import {ErroOperacao,limparTextoOperacao,mensagemErroOperacao,type ClienteOperacao,type ContatoOperacao,type CriacaoContatoOperacao} from './operacao-api';

const inicial={nome:'',telefone:'',email:'',descricao:'',classificacao:'lead' as 'lead'|'cliente'};
const ajudaTelefone='Brasil: DDI +55. Digite o DDD e o número, ou use + e o DDI para outro país. Exemplo: +55 (11) 91234-5678.';

export type DadosIniciaisNovoContato=Partial<Pick<typeof inicial,'nome'|'telefone'|'email'|'descricao'>>;
export default function NovoContatoOperacao({cliente,fechar,salvo,falhar,dadosIniciais,podeSalvar=false}:{podeSalvar?:boolean;cliente:ClienteOperacao;fechar:()=>void;salvo:(contato:ContatoOperacao,reutilizado:boolean)=>void;falhar:(erro:unknown)=>void;dadosIniciais?:DadosIniciaisNovoContato}){
 const base=useRef({...inicial,...dadosIniciais});
 const [dados,setDados]=useState(base.current),[ocupado,setOcupado]=useState(false),[erro,setErro]=useState(''),[incerto,setIncerto]=useState(false),[telefoneVisitado,setTelefoneVisitado]=useState(false);
 const vivo=useRef(true);useEffect(()=>{vivo.current=true;return()=>{vivo.current=false;};},[]);
 const emCurso=useRef(false),pedido=useRef<CriacaoContatoOperacao|null>(null);
 let telefoneNormalizado='';try{telefoneNormalizado='+'+normalizarTelefoneContato(dados.telefone);}catch{/* Validação final usa o mesmo contrato do servidor. */}
 const telefoneValido=!!telefoneNormalizado;
 const emailValido=!dados.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email),alterado=JSON.stringify(dados)!==JSON.stringify(base.current);
 function alterar(campo:keyof typeof dados,valor:string){if(ocupado||incerto)return;pedido.current=null;setErro('');setDados(d=>({...d,[campo]:valor}));}
 async function salvar(evento:FormEvent){
  evento.preventDefault();if(!podeSalvar||emCurso.current||!dados.nome.trim()||!telefoneValido||!emailValido)return;
  emCurso.current=true;setOcupado(true);setErro('');pedido.current??={...dados,telefone:dados.telefone.trim(),ddi:'55',idempotencia:crypto.randomUUID()};
  try{const r=await cliente.criarContato(pedido.current);if(vivo.current){salvo(r.contato,r.reutilizado);fechar();}}
  catch(e){if(vivo.current){if(e instanceof ErroOperacao&&e.codigo==='LOGIN')falhar(e);else{const indefinido=e instanceof ErroOperacao&&e.codigo==='RESULTADO_INCERTO';setIncerto(indefinido);if(!indefinido)pedido.current=null;setErro(indefinido?'A confirmação do cadastro não chegou. Clique em Conferir cadastro para verificar o mesmo cadastro.':mensagemErroOperacao(e));}}}
  finally{emCurso.current=false;if(vivo.current)setOcupado(false);}
 }
 return <Dialog open alterado={alterado} onOpenChange={aberto=>{if(!aberto&&!ocupado)fechar();}}><DialogContent className="modal modal-novo-contato" showCloseButton={false}><DialogHeader className="cadastro-contato-cabecalho"><DialogTitle>Novo contato</DialogTitle><DialogClose className="close-icon" aria-label="Fechar cadastro de contato" disabled={ocupado}><X size={20}/></DialogClose></DialogHeader><DialogDescription>Cadastre o contato. Depois, escolha Iniciar conversa. Nenhuma mensagem será enviada no cadastro.</DialogDescription><form className="operacao-form" onSubmit={evento=>void salvar(evento)}>
  <label htmlFor="novo-contato-nome">Nome<Input id="novo-contato-nome" className="field" maxLength={200} autoComplete="name" autoFocus required value={dados.nome} disabled={ocupado||incerto||!podeSalvar} onChange={e=>alterar('nome',limparTextoOperacao(e.target.value,200).replace(/[\r\n\t]/g,''))}/></label>
  <label htmlFor="novo-contato-telefone">Telefone<CampoTelefoneContato id="novo-contato-telefone" className="field" autoComplete="tel" required placeholder="(11) 91234-5678" value={dados.telefone} aria-describedby="novo-contato-telefone-ajuda" aria-invalid={telefoneVisitado&&!telefoneValido} disabled={ocupado||incerto||!podeSalvar} onBlur={()=>setTelefoneVisitado(true)} alterar={valor=>alterar('telefone',valor)}/></label>
  <p id="novo-contato-telefone-ajuda" className="muted">{ajudaTelefone} O telefone fica fixo após o cadastro.</p>{telefoneNormalizado&&<p className="muted">Telefone para conferência: <strong>{telefoneNormalizado}</strong></p>}{telefoneVisitado&&!telefoneValido&&<p className="cadastro-contato-erro" role="status">Confira o DDD, o DDI e a quantidade de dígitos do telefone.</p>}
  <div className="form-grid"><label htmlFor="novo-contato-email">E-mail (opcional)<Input id="novo-contato-email" className="field" type="email" maxLength={254} autoComplete="email" value={dados.email} disabled={ocupado||incerto||!podeSalvar} onChange={e=>alterar('email',limparTextoOperacao(e.target.value,254).replace(/\s/g,''))}/></label><label htmlFor="novo-contato-classificacao">Classificação<Escolha id="novo-contato-classificacao" label="Classificação do novo contato" value={dados.classificacao} options={[{valor:'lead',rotulo:'Lead'},{valor:'cliente',rotulo:'Cliente'}]} disabled={ocupado||incerto||!podeSalvar} onChange={valor=>alterar('classificacao',valor)}/></label></div>
  <label htmlFor="novo-contato-descricao">Descrição breve (opcional)<Input id="novo-contato-descricao" className="field" maxLength={200} placeholder="Empresa, cargo ou contexto" value={dados.descricao} disabled={ocupado||incerto||!podeSalvar} onChange={e=>alterar('descricao',limparTextoOperacao(e.target.value,200).replace(/[\r\n\t]/g,''))}/></label>
  {erro&&<p className="cadastro-contato-erro" role="alert">{erro}</p>}<div className="toolbar"><DialogClose type="button" className="btn" disabled={ocupado}>Cancelar</DialogClose><Button type="submit" variant="entrada" className="btn acao-confirmar" disabled={ocupado||!podeSalvar||!dados.nome.trim()||!telefoneValido||!emailValido}>{ocupado?'Salvando…':incerto?'Conferir cadastro':'Salvar contato'}</Button></div>
 </form></DialogContent></Dialog>;
}
