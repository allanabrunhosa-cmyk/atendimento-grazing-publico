import type {IncomingMessage,ServerResponse} from 'node:http';
import type {IdentidadeOperacao} from './operacao-tipos';
import type {ServicoComercialOperacao} from './operacao-comercial';
/** Usa a autenticação, origem e CSRF do handler operacional existente. */
export function criarExtensaoComercial(comercial:ServicoComercialOperacao){
 return async(req:IncomingMessage,res:ServerResponse,i:IdentidadeOperacao,p?:Record<string,unknown>)=>{
  const url=new URL(req.url??'/','https://atendimento.grazinghub.com.br'),path=url.pathname.replace('/api/atendimento/operacao',''),metodo=req.method??'GET';
  if(!['/comercial/status','/comercial/produtos','/comercial/pedidos','/comercial/vinculos','/comercial/vinculos/salvar'].includes(path))return false;
  const campos=path==='/comercial/produtos'?['busca','ambiente']:path==='/comercial/pedidos'?['conversaId','numero','ambiente']:['ambiente'];
  if([...url.searchParams.keys()].some(k=>!campos.includes(k)))throw Error('OPERACAO_ENTRADA_INVALIDA');
  const sinal=AbortSignal.timeout(10000);let resultado:unknown;
  if(['GET','HEAD'].includes(metodo)){
   if(path==='/comercial/status')resultado=await comercial.status(i);
   else if(path==='/comercial/produtos')resultado=await comercial.produtos(i,url.searchParams.get('busca')??'',sinal);
   else if(path==='/comercial/pedidos')resultado=await comercial.pedidos(i,url.searchParams.get('conversaId')??'',url.searchParams.get('numero')??'',sinal);
   else if(path==='/comercial/vinculos')resultado=await comercial.configuracao(i);
   else {res.writeHead(405);res.end();return true;}
  }else if(metodo==='POST'&&path==='/comercial/vinculos/salvar'){
   if(!p||Object.keys(p).some(k=>!['hubId','produtoWooId','variacaoWooId','versao','idempotencia'].includes(k)))throw Error('OPERACAO_ENTRADA_INVALIDA');
   resultado=await comercial.salvarVinculo(i,p as Parameters<ServicoComercialOperacao['salvarVinculo']>[1],sinal);
  }else{res.writeHead(405);res.end();return true;}
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(metodo==='HEAD'?undefined:JSON.stringify(resultado));return true;
 };
}
