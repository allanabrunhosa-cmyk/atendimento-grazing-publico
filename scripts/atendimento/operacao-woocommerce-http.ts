import type {IncomingMessage,ServerResponse} from 'node:http';
import type {ServicoAutomacoesWoo} from '../../src/lib/atendimento/operacao-woocommerce-automacoes';

export const ROTA_WOO_OPERACAO='/api/atendimento/woocommerce/webhook';
export const LIMITE_WOO_OPERACAO=1024*1024;
export function criarHandlerWooOperacao(servico:Pick<ServicoAutomacoesWoo,'receber'>,limiteConcorrencia=8){
 let ativos=0;
 return async(req:IncomingMessage,res:ServerResponse):Promise<boolean>=>{
  if((req.url??'').split('?')[0]!==ROTA_WOO_OPERACAO)return false;
  const responder=(status:number,corpo:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(corpo));};
  if(req.method!=='POST'){responder(405,{erro:'METODO_RECUSADO'});return true;}
  if(ativos>=limiteConcorrencia){responder(503,{erro:'WOO_SERVICO_OCUPADO'});return true;}
  ativos++;
  try{
   const partes:Buffer[]=[];let tamanho=0;
   for await(const parte of req){const b=Buffer.isBuffer(parte)?parte:Buffer.from(parte);tamanho+=b.length;if(tamanho>LIMITE_WOO_OPERACAO){responder(413,{erro:'WOO_CORPO_GRANDE'});return true;}partes.push(b);}
   const headers:Record<string,string|undefined>={};
   for(const nome of ['x-wc-webhook-signature','x-wc-webhook-id','x-wc-webhook-delivery-id','x-wc-webhook-source','x-wc-webhook-topic','x-wc-webhook-resource','x-wc-webhook-event','content-type']){const v=req.headers[nome];headers[nome]=typeof v==='string'?v:undefined;}
   const resultado=await servico.receber(Buffer.concat(partes),headers);
   responder(200,resultado);return true;
  }catch(e){
   const codigo=e instanceof Error&&/^WOO_[A-Z0-9_]{1,70}$/.test(e.message)?e.message:'WOO_PERSISTENCIA_NAO_CONFIRMADA';
   const status=['WOO_ASSINATURA_INVALIDA','WOO_ESCOPO_WEBHOOK_INVALIDO'].includes(codigo)?401:codigo==='WOO_RECEPCAO_DESARMADA'?503:codigo==='WOO_ENTREGA_DIVERGENTE'?409:['WOO_PEDIDO_INVALIDO','WOO_DESTINATARIO_INVALIDO','WOO_DATA_INVALIDA'].includes(codigo)?400:503;
   responder(status,{erro:codigo});return true;
  }finally{ativos--;}
 };
}
