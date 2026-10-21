import {useCallback,useEffect,useRef,useState} from 'react';
import {ErroOperacao,mensagemErroOperacao,type ClienteOperacao,type ComandoAgenteOperacao,type EstadoAgenteOperacao} from './operacao-api';

type Pendente={comando:ComandoAgenteOperacao;situacao:'incerta'|'confirmada'|'nao_registrada';versao:number|null};
type Props={cliente:ClienteOperacao;usuarioId:string;podeEditar:boolean;adotar:(estado:EstadoAgenteOperacao,rascunho?:ComandoAgenteOperacao)=>void;confirmar:(comando:ComandoAgenteOperacao,estado:EstadoAgenteOperacao)=>void;falhar:(e:unknown)=>void};
const objeto=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const campos=(v:Record<string,unknown>,nomes:string[])=>Object.keys(v).every(k=>nomes.includes(k));
const numero=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
/** Só o pedido sanitizado fica nesta aba. Não guardar sessão, CSRF ou credenciais. */
function ler(chave:string):Pendente|null{
 try{
  const texto=sessionStorage.getItem(chave);if(!texto||texto.length>10000)return null;const p:unknown=JSON.parse(texto);
  if(!objeto(p)||!campos(p,['comando','situacao','versao'])||!['incerta','confirmada','nao_registrada'].includes(String(p.situacao))||p.versao!==null&&!numero(p.versao)||!objeto(p.comando)||!campos(p.comando,['tipo','pedido'])||!objeto(p.comando.pedido))return null;
  const c=p.comando,d=c.pedido as Record<string,unknown>;if(!numero(d.versao)||Number(d.versao)<1||typeof d.idempotencia!=='string'||!(/^[a-f0-9-]{36}$/i.test(d.idempotencia)))return null;
  if(c.tipo==='controle'){if(!campos(d,['acao','versao','idempotencia'])||!['ligar','pausar'].includes(String(d.acao)))return null;}
  else if(c.tipo==='salvar'){
   const a=d.conteudo;if(!campos(d,['conteudo','versao','idempotencia'])||!objeto(a)||!campos(a,['provedor','modo','modelo','maxTokens','equipeApoio','limites','custoCentavosDia','autoridadeAutomatica','grupoExterno','moedaOrcamento'])||!['anthropic','google','openai'].includes(String(a.provedor))||!['desligado','rascunho','automatico'].includes(String(a.modo))||typeof a.modelo!=='string'||!(/^[A-Za-z0-9._:-]{0,90}$/.test(a.modelo))||typeof a.equipeApoio!=='string'||!(/^[A-Za-z0-9_-]{1,100}$/.test(a.equipeApoio))||!numero(a.maxTokens)||!numero(a.custoCentavosDia)||typeof a.autoridadeAutomatica!=='boolean'||a.grupoExterno!=='indisponivel'||a.moedaOrcamento!=='USD'||!objeto(a.limites)||Object.keys(a.limites).length!==5||!campos(a.limites,['maxChamadas','custoPorChamadaCentavos','maxCustoCentavos','maxDuracaoMs','timeoutChamadaMs'])||!Object.values(a.limites).every(numero))return null;
  }else return null;
  return p as unknown as Pendente;
 }catch{return null;}
}
const incerto=(e:unknown)=>!(e instanceof ErroOperacao)||e.codigo==='RESULTADO_INCERTO'||e.codigo==='INVALIDO'&&e.status===0;

export function useComandoAgente({cliente,usuarioId,podeEditar,adotar,confirmar,falhar}:Props){
 const chave=`atendimento:agente:pedido:${cliente.ambienteOperacao}:${encodeURIComponent(usuarioId)}`;
 const [pendente,setPendente]=useState<Pendente|null>(()=>podeEditar?ler(chave):null),[ocupado,setOcupado]=useState(false),[erro,setErro]=useState(''),[conferido,setConferido]=useState(false);
 const atual=useRef(pendente),emCurso=useRef(false);
 const guardar=useCallback((p:Pendente|null)=>{if(p)sessionStorage.setItem(chave,JSON.stringify(p));else sessionStorage.removeItem(chave);atual.current=p;setPendente(p);},[chave]);
 const consultar=useCallback(async(p:Pendente)=>{
  const r=await cliente.reconciliarAgente(p.comando);
  if(p.situacao==='confirmada'&&r.estado!=='confirmada')throw new Error('RECIBO_AINDA_NAO_CONFERIDO');
  const conhecido:Pendente={...p,situacao:r.estado==='confirmada'?'confirmada':'nao_registrada',versao:r.versao};guardar(conhecido);
  const estado=await cliente.agente();if(r.estado==='confirmada'&&(r.versao===null||estado.versao<r.versao))throw new Error('ESTADO_AINDA_NAO_ATUALIZADO');
  adotar(estado,r.estado==='nao_registrada'?p.comando:undefined);setConferido(true);setErro('');
  if(r.estado==='confirmada'){guardar(null);confirmar(p.comando,estado);}
 },[cliente,guardar,adotar,confirmar]);
 const registrarFalha=useCallback((e:unknown)=>{
  setConferido(false);setErro(atual.current?.situacao==='confirmada'?'A operação foi confirmada no servidor. A tela ainda não foi atualizada. Confira novamente; não repita a alteração.':'Ainda não foi possível conferir esta solicitação no servidor. Ela foi preservada nesta aba. Confira novamente antes de repetir.');
  if(e instanceof ErroOperacao&&(e.codigo==='LOGIN'||e.codigo==='PERMISSAO')){setErro(mensagemErroOperacao(e));falhar(e);}
 },[falhar]);
 const conferir=useCallback(async()=>{
  const p=atual.current;if(!p||!podeEditar||emCurso.current)return;emCurso.current=true;setOcupado(true);setErro('');try{await consultar(p);}catch(e){registrarFalha(e);}finally{emCurso.current=false;setOcupado(false);}
 },[podeEditar,consultar,registrarFalha]);
 useEffect(()=>{const p=podeEditar?ler(chave):null;atual.current=p;queueMicrotask(()=>{setConferido(false);setPendente(p);if(p)void conferir();});},[chave,podeEditar,conferir]);
 async function enviar(p:Pendente){
  emCurso.current=true;setOcupado(true);setErro('');setConferido(false);
  try{guardar({...p,situacao:'incerta',versao:null});}catch{setErro('Não foi possível preservar a solicitação nesta aba. Nenhuma alteração foi enviada. Libere o armazenamento da sessão e tente novamente.');emCurso.current=false;setOcupado(false);return;}
  try{
   try{const r=p.comando.tipo==='salvar'?await cliente.configurarAgente(p.comando.pedido):await cliente.controlarAgente(p.comando.pedido);guardar({...p,situacao:'confirmada',versao:r.versao});}
   catch(e){if(!incerto(e)){guardar(null);setErro(mensagemErroOperacao(e));if(e instanceof ErroOperacao&&(e.codigo==='LOGIN'||e.codigo==='PERMISSAO'))falhar(e);return;}}
   try{await consultar(atual.current!);}catch(e){registrarFalha(e);}
  }finally{emCurso.current=false;setOcupado(false);}
 }
 async function executar(comando:ComandoAgenteOperacao){if(!podeEditar||emCurso.current||atual.current)return;await enviar({comando,situacao:'incerta',versao:null});}
 async function repetir(){const p=atual.current;if(!p||p.situacao!=='nao_registrada'||!conferido||!podeEditar||emCurso.current)return;await enviar(p);}
 function descartar(){if(!podeEditar||emCurso.current||atual.current?.situacao!=='nao_registrada'||!conferido)return;try{guardar(null);setErro('');}catch{setErro('Não foi possível encerrar a conferência nesta aba.');}}
 return {pendente,ocupado,erro,conferido,executar,conferir,repetir,descartar};
}
