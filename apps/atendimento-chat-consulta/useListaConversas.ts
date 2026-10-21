import {useCallback,useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';
import {ErroOperacao,type CanalOperacao,type ClienteOperacao,type ConversaOperacao,type PaginaConversasOperacao} from './operacao-api';

type Opcoes={cliente:ClienteOperacao;ativa:boolean;filtro:string;estado:string;canal:CanalOperacao|'';revisao:number;reinicio:number;falhar:(e:unknown)=>void};
type Operacao='atualizar'|'mais';
function unicas(linhas:ConversaOperacao[]){const ids=new Set<string>();return linhas.filter(v=>{if(ids.has(v.id))return false;ids.add(v.id);return true;});}

/** O próximo bloco consulta apenas 30 linhas. Uma atualização recompõe o prefixo
 * carregado, pois mensagens novas podem mudar a ordem entre os blocos. */
export function useListaConversas({cliente,ativa,filtro,estado,canal,revisao,reinicio,falhar}:Opcoes){
 const [listaEstado,definirLista]=useState<PaginaConversasOperacao|null>(null),[carregando,setCarregando]=useState(false),[carregandoMais,setCarregandoMais]=useState(false),[erro,setErro]=useState<Operacao|null>(null);
 const listaRef=useRef(listaEstado),erroRef=useRef<Operacao|null>(null),geracao=useRef(0),emCurso=useRef(false),controle=useRef<AbortController|null>(null),chaveAtual=useRef(''),clienteAtual=useRef(cliente);
 const atualizacaoPendente=useRef(false),chaveConsulta=JSON.stringify([filtro,estado,canal,reinicio]);
 const revisaoObservada=useRef({cliente,ativa,chave:chaveConsulta,revisao});
 const setLista:Dispatch<SetStateAction<PaginaConversasOperacao|null>>=useCallback(valor=>{const nova=typeof valor==='function'?valor(listaRef.current):valor;listaRef.current=nova;definirLista(nova);},[]);
 const operar=useCallback(async function executar(tipo:Operacao,repeticao=false){
  if(!ativa||emCurso.current||erroRef.current&&!repeticao||tipo==='mais'&&!listaRef.current?.mais)return;
  const epoca=geracao.current,c=new AbortController(),anterior=listaRef.current;
  if(repeticao){erroRef.current=null;setErro(null);}
  emCurso.current=true;controle.current=c;
  if(tipo==='mais')setCarregandoMais(true);else setCarregando(true);
  const vigente=()=>epoca===geracao.current&&!c.signal.aborted;
  try{
   const consultar=async(pagina:number)=>{const p=await cliente.conversas(filtro,estado,'',pagina,c.signal,canal);if(p.pagina!==pagina||p.registros.length>30||p.mais&&!p.registros.length)throw new ErroOperacao('INVALIDO');return p;};
   let nova:PaginaConversasOperacao;
   if(tipo==='mais'){
    const p=await consultar((anterior?.pagina??0)+1);if(!vigente())return;
    const registros=unicas([...(listaRef.current?.registros??[]),...p.registros]);
    if(p.mais&&registros.length===(anterior?.registros.length??0))throw new ErroOperacao('INVALIDO');
    nova={...p,registros};
   }else{
    const ultima=anterior?.pagina??0;let principal:PaginaConversasOperacao|null=null,final:PaginaConversasOperacao|null=null;const registros:ConversaOperacao[]=[];
    for(let pagina=0;pagina<=ultima;pagina++){
     const p=await consultar(pagina);if(!vigente())return;principal??=p;final=p;registros.push(...p.registros);if(!p.mais)break;
    }
    nova={...principal!,pagina:final!.pagina,mais:final!.mais,registros:unicas(registros)};
   }
   if(vigente()){setLista(nova);erroRef.current=null;setErro(null);}
  }catch(e){if(vigente()){erroRef.current=tipo;setErro(tipo);if(tipo==='atualizar')setLista(l=>l?{...l,contagens:null,contagensConferidasEm:null}:null);falhar(e);}}
  finally{if(epoca===geracao.current){
   emCurso.current=false;controle.current=null;setCarregando(false);setCarregandoMais(false);
   // Uma rajada de eventos pede só uma recomposição depois deste resultado.
   // Não reiniciar pela página zero enquanto o prefixo ainda está chegando.
   const atualizar=atualizacaoPendente.current;atualizacaoPendente.current=false;
   if(atualizar&&!erroRef.current)void executar('atualizar');
  }}
 },[cliente,ativa,filtro,estado,canal,falhar,setLista]);
 useEffect(()=>{
  geracao.current++;controle.current?.abort();emCurso.current=false;atualizacaoPendente.current=false;setCarregando(false);setCarregandoMais(false);
  const mudou=chaveAtual.current!==chaveConsulta||clienteAtual.current!==cliente;
  chaveAtual.current=chaveConsulta;clienteAtual.current=cliente;
  if(!ativa||mudou){setLista(null);erroRef.current=null;setErro(null);}
  if(!ativa){chaveAtual.current='';return;}
  if(!erroRef.current)void operar('atualizar');
  const epoca=geracao.current;
  return()=>{geracao.current=epoca+1;controle.current?.abort();emCurso.current=false;atualizacaoPendente.current=false;};
 },[cliente,ativa,chaveConsulta,operar,setLista]);
 useEffect(()=>{
  const anterior=revisaoObservada.current;revisaoObservada.current={cliente,ativa,chave:chaveConsulta,revisao};
  if(!ativa||anterior.cliente!==cliente||anterior.ativa!==ativa||anterior.chave!==chaveConsulta||anterior.revisao===revisao||erroRef.current)return;
  if(emCurso.current){atualizacaoPendente.current=true;return;}
  void operar('atualizar');
 },[cliente,ativa,chaveConsulta,revisao,operar]);
 // O próximo vencimento abrange o filtro inteiro, inclusive páginas ainda não
 // carregadas. Não depende de mensagem nova nem do relógio civil do computador.
 const proximoLembrete=listaEstado?.proximoLembreteEm,conferidoEm=listaEstado?.contagensConferidasEm,recebidoEm=listaEstado?.lembretesRecebidosEm;
 useEffect(()=>{
  if(!ativa||!proximoLembrete||!conferidoEm||recebidoEm===undefined)return;
  const restante=Date.parse(proximoLembrete)-Date.parse(conferidoEm)-Math.max(0,performance.now()-recebidoEm);
  if(!Number.isFinite(restante))return;
  const timer=setTimeout(()=>{
   if(document.visibilityState==='hidden'||erroRef.current)return;
   if(emCurso.current){atualizacaoPendente.current=true;return;}
   void operar('atualizar');
  },Math.min(2_147_483_647,Math.max(0,restante)+50));
  return()=>clearTimeout(timer);
 },[ativa,proximoLembrete,conferidoEm,recebidoEm,operar]);
 const carregarMais=useCallback(()=>operar('mais'),[operar]);
 const repetir=useCallback(()=>{if(erroRef.current)void operar(erroRef.current,true);},[operar]);
 return {lista:listaEstado,setLista,carregando,carregandoMais,erro,carregarMais,repetir};
}
