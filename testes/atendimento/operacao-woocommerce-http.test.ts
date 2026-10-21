import {createServer,request,type Server} from 'node:http';
import {createHmac} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {criarHandlerWooOperacao,ROTA_WOO_OPERACAO,LIMITE_WOO_OPERACAO} from '../../scripts/atendimento/operacao-woocommerce-http';
import {ServicoAutomacoesWoo,conferirAssinaturaWoo,type ConfiguracaoAutomacoesWoo} from '../../src/lib/atendimento/operacao-woocommerce-automacoes';
import type {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';

vi.mock('server-only',()=>({}));
const servidores:Server[]=[];
const corpo=Buffer.from(' { "id": 123, "status": "processing", "billing": { "first_name": "Fictício", "phone": "5511999990077" } }\n');
const configuracao:ConfiguracaoAutomacoesWoo={site:'https://loja.fixture.example',segredo:'segredo-ficticio-nao-real',webhookIds:['123'],habilitado:true,modo:'operacao',autoridade:'vps',enviosHabilitados:true,ficticio:true};
const cabecalhos=()=>({
 'x-wc-webhook-signature':createHmac('sha256',configuracao.segredo).update(corpo).digest('base64'),
 'x-wc-webhook-id':'123',
 'x-wc-webhook-delivery-id':'entrega-ficticia-1',
 'x-wc-webhook-source':'https://loja.fixture.example',
 'x-wc-webhook-topic':'order.updated',
 'x-wc-webhook-resource':'order',
 'x-wc-webhook-event':'updated',
 'content-type':'application/json; charset=utf-8',
});
const preservado=()=>({estado:'preservado',agendadas:0,agendadasCrm:0} as const);
type ResultadoHttp={status:number;headers:Record<string,string|string[]|undefined>;texto:string};
async function iniciar(receber:ServicoAutomacoesWoo['receber']){
 const handler=criarHandlerWooOperacao({receber});
 const servidor=createServer((req,res)=>{
  void handler(req,res).then(tratado=>{if(!tratado){res.writeHead(404);res.end('Rota não tratada.');}}).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end('Falha inesperada do ensaio.');});
 });
 servidores.push(servidor);await new Promise<void>((resolve,reject)=>{servidor.once('error',reject);servidor.listen(0,'127.0.0.1',resolve);});
 const porta=(servidor.address() as AddressInfo).port;
 return (p:{metodo?:string;path?:string;body?:Buffer;headers?:Record<string,string>;partes?:Buffer[]}={}):Promise<ResultadoHttp>=>new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port:porta,path:p.path??ROTA_WOO_OPERACAO,method:p.metodo??'POST',headers:p.headers??cabecalhos(),agent:false},res=>{
   const partes:Buffer[]=[];res.on('data',b=>partes.push(Buffer.from(b)));res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode??0,headers:res.headers,texto:Buffer.concat(partes).toString('utf8')}));
  });
  req.once('error',reject);for(const b of p.partes??[p.body??corpo])req.write(b);req.end();
 });
}
afterEach(async()=>{
 await Promise.all(servidores.splice(0).map(s=>new Promise<void>((resolve,reject)=>{s.closeAllConnections();s.close(e=>e?reject(e):resolve());})));
});

describe('receptor Woo pelo servidor HTTP real, somente loopback',()=>{
 it('preserva os bytes e todos os headers autorizados sem normalizar o JSON',async()=>{
  const receber=vi.fn<ServicoAutomacoesWoo['receber']>(async(raw,headers)=>{conferirAssinaturaWoo(raw,headers,configuracao);return preservado();});
  const chamar=await iniciar(receber),headers=cabecalhos(),r=await chamar({headers:{...headers,authorization:'nao-repassar-ficticio'},partes:[corpo.subarray(0,17),corpo.subarray(17)]});
  expect(r.status).toBe(200);expect(JSON.parse(r.texto)).toEqual(preservado());expect(receber).toHaveBeenCalledOnce();
  expect(receber.mock.calls[0][0].equals(corpo)).toBe(true);expect(receber.mock.calls[0][1]).toEqual(headers);
  expect(r.headers['cache-control']).toBe('no-store');expect(r.headers['x-content-type-options']).toBe('nosniff');
 });
 it('responde somente depois da confirmação do serviço, sem ACK antecipado',async()=>{
  let liberar!:()=>void;const pendente=new Promise<void>(resolve=>{liberar=resolve;});
  const receber=vi.fn<ServicoAutomacoesWoo['receber']>(async()=>{await pendente;return preservado();});const chamar=await iniciar(receber);
  let respondeu=false;const chamada=chamar().then(r=>{respondeu=true;return r;});void chamada.catch(()=>undefined);
  try{await vi.waitFor(()=>expect(receber).toHaveBeenCalledOnce());expect(respondeu).toBe(false);}finally{liberar();}
  expect((await chamada).status).toBe(200);
 });
 it.each(['GET','HEAD','PUT','DELETE'])('recusa %s antes do serviço',async metodo=>{
  const receber=vi.fn<ServicoAutomacoesWoo['receber']>(async()=>preservado()),chamar=await iniciar(receber),r=await chamar({metodo,body:Buffer.alloc(0)});
  expect(r.status).toBe(405);expect(receber).not.toHaveBeenCalled();if(metodo!=='HEAD')expect(JSON.parse(r.texto).erro).toBe('METODO_RECUSADO');
 });
 it('não assume rotas próximas e mantém o endpoint exato com query',async()=>{
  const receber=vi.fn<ServicoAutomacoesWoo['receber']>(async()=>preservado()),chamar=await iniciar(receber);
  expect((await chamar({path:ROTA_WOO_OPERACAO+'/outro'})).status).toBe(404);expect(receber).not.toHaveBeenCalled();
  expect((await chamar({path:ROTA_WOO_OPERACAO+'?fixture=1'})).status).toBe(200);expect(receber).toHaveBeenCalledOnce();
 });
 it.each(['assinatura','bytes','escopo'] as const)('retorna 401 para %s inválido, sem confirmar entrega',async caso=>{
  const receber=vi.fn<ServicoAutomacoesWoo['receber']>(async(raw,headers)=>{conferirAssinaturaWoo(raw,headers,configuracao);return preservado();});const chamar=await iniciar(receber),headers=cabecalhos();
  if(caso==='assinatura')headers['x-wc-webhook-signature']=Buffer.alloc(32).toString('base64');if(caso==='escopo')headers['x-wc-webhook-id']='999';
  const r=await chamar({headers,body:caso==='bytes'?Buffer.concat([corpo,Buffer.from(' ')]):corpo});expect(r.status).toBe(401);expect(JSON.parse(r.texto).erro).toBe(caso==='escopo'?'WOO_ESCOPO_WEBHOOK_INVALIDO':'WOO_ASSINATURA_INVALIDA');
 });
 it.each(['homologacao','desabilitado'] as const)('mantém %s em 503 sem confirmar/persistir pedido',async estado=>{
  const transacao=vi.fn(async()=>{throw Error('BANCO_NAO_DEVERIA_SER_CHAMADO');});
  const servico=new ServicoAutomacoesWoo({repo:{transacao} as unknown as RepositorioOperacaoPg,empresaId:'fixture',canalNumeroId:'123456789',configuracao:()=>({...configuracao,modo:estado==='homologacao'?'homologacao':'operacao',habilitado:estado!=='desabilitado'})});
  const chamar=await iniciar(servico.receber.bind(servico)),r=await chamar();expect(r.status).toBe(503);expect(JSON.parse(r.texto)).toEqual({erro:'WOO_RECEPCAO_DESARMADA'});expect(transacao).not.toHaveBeenCalled();
 });
 it('mapeia uma repetição com conteúdo divergente para 409',async()=>{
  const receber=vi.fn<ServicoAutomacoesWoo['receber']>(async()=>{throw Error('WOO_ENTREGA_DIVERGENTE');}),chamar=await iniciar(receber),r=await chamar();
  expect(r.status).toBe(409);expect(JSON.parse(r.texto)).toEqual({erro:'WOO_ENTREGA_DIVERGENTE'});
 });
 it.each(['declarado','chunked'] as const)('limita corpo %s acima de 1 MiB antes do serviço e libera a vaga',async tipo=>{
  const receber=vi.fn<ServicoAutomacoesWoo['receber']>(async()=>preservado()),chamar=await iniciar(receber),body=Buffer.alloc(LIMITE_WOO_OPERACAO+1,32);
  const r=await chamar({body,headers:{...cabecalhos(),...(tipo==='declarado'?{'content-length':String(body.length)}:{})},partes:[body.subarray(0,262144),body.subarray(262144)]});
  expect(r.status).toBe(413);expect(JSON.parse(r.texto)).toEqual({erro:'WOO_CORPO_GRANDE'});expect(receber).not.toHaveBeenCalled();
  expect((await chamar()).status).toBe(200);expect(receber).toHaveBeenCalledOnce();
 });
 it('limita a oito requisições e recupera a vaga no finally após erro',async()=>{
  const liberadores=new Map<string,()=>void>();
  const receber=vi.fn<ServicoAutomacoesWoo['receber']>(async(_raw,headers)=>{await new Promise<void>(resolve=>{liberadores.set(headers['x-wc-webhook-delivery-id']!,resolve);});if(headers['x-wc-webhook-delivery-id']==='falhar-ficticio')throw Error('falha-ficticia-sem-expor');return preservado();});const chamar=await iniciar(receber);
  const chamadas=Array.from({length:8},(_,n)=>chamar({headers:{...cabecalhos(),'x-wc-webhook-delivery-id':n===0?'falhar-ficticio':'entrega-ficticia-'+n}}));
  for(const chamada of chamadas)void chamada.catch(()=>undefined);
  try{
   await vi.waitFor(()=>expect(receber).toHaveBeenCalledTimes(8));const nona=await chamar();expect(nona.status).toBe(503);expect(JSON.parse(nona.texto)).toEqual({erro:'WOO_SERVICO_OCUPADO'});expect(receber).toHaveBeenCalledTimes(8);
   liberadores.get('falhar-ficticio')!();expect((await chamadas[0]).status).toBe(503);
   const retomada=chamar({headers:{...cabecalhos(),'x-wc-webhook-delivery-id':'retomada-ficticia'}});void retomada.catch(()=>undefined);await vi.waitFor(()=>expect(receber).toHaveBeenCalledTimes(9));liberadores.get('retomada-ficticia')!();expect((await retomada).status).toBe(200);
  }finally{for(const liberar of liberadores.values())liberar();await Promise.all(chamadas);}
 });
 it('oculta a mensagem interna e não devolve corpo/headers de uma falha',async()=>{
  const receber=vi.fn<ServicoAutomacoesWoo['receber']>(async()=>{throw Error('segredo-ficticio-nao-real '+corpo.toString('utf8'));}),chamar=await iniciar(receber),r=await chamar();
  expect(r.status).toBe(503);expect(JSON.parse(r.texto)).toEqual({erro:'WOO_PERSISTENCIA_NAO_CONFIRMADA'});expect(r.texto).not.toContain('segredo');expect(r.texto).not.toContain('Fictício');expect(r.texto).not.toContain('5511999990077');
 });
});
