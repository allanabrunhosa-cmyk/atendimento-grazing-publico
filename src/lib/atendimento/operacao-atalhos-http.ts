import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ServicoAtalhosOperacao,PedidoSalvarAtalhoOperacao,PedidoExcluirAtalhoOperacao} from './operacao-atalhos';
import type {IdentidadeOperacao} from './operacao-tipos';

/** Recebe somente requisições já autenticadas e conferidas pelo handler (origem e CSRF). */
export function criarExtensaoAtalhos(atalhos:ServicoAtalhosOperacao){
 return async(req:IncomingMessage,res:ServerResponse,i:IdentidadeOperacao,p?:Record<string,unknown>)=>{
  const url=new URL(req.url??'/','https://atendimento.grazinghub.com.br'),path=url.pathname.replace('/api/atendimento/operacao',''),metodo=req.method??'GET';
  if(!['/atalhos','/atalhos/salvar','/atalhos/excluir'].includes(path))return false;
  if([...url.searchParams.keys()].some(k=>k!=='ambiente'))throw Error('OPERACAO_ENTRADA_INVALIDA');
  let resultado:unknown;
  if(path==='/atalhos'&&['GET','HEAD'].includes(metodo))resultado=await atalhos.listar(i);
  else if(metodo==='POST'&&path!=='/atalhos'){
   const campos=path==='/atalhos/salvar'?['id','nome','texto','versao','idempotencia']:['id','versao','idempotencia'];
   if(!p||Object.keys(p).some(k=>!campos.includes(k)))throw Error('OPERACAO_ENTRADA_INVALIDA');
   resultado=path==='/atalhos/salvar'?await atalhos.salvar(i,p as PedidoSalvarAtalhoOperacao):await atalhos.excluir(i,p as PedidoExcluirAtalhoOperacao);
  }else{res.writeHead(405);res.end();return true;}
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(metodo==='HEAD'?undefined:JSON.stringify(resultado));return true;
 };
}
