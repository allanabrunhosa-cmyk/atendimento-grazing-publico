import 'server-only';

export type PedidoEnvioTexto={id:string;destinatario:string;texto:string;respostaA?:string};
export type ResultadoEnvio={estado:'aceito';wamid:string}|{estado:'recusado';http:number;codigo:number}|{estado:'incerto';codigo:'META_RESULTADO_DESCONHECIDO'};
type Configuracao={token:string;numeroId:string;versao:string;modo:'homologacao'|'operacao';destinatariosAutorizados:string[]};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const wamid=/^wamid\.[A-Za-z0-9_+/=-]{1,500}$/;
function objeto(x:unknown):x is Record<string,unknown>{return !!x&&typeof x==='object'&&!Array.isArray(x);}

/** Nenhum retry dentro do transporte. Timeout/5xx/resposta ambigua preservam
 * estado incerto para reconciliacao; aceito pela Meta nao significa entregue.
 * Somente o servidor fornece configuracao/autoridade e revalida o autor.
 */
export async function enviarTextoWhatsApp(p:PedidoEnvioTexto,c:Configuracao,revalidar:()=>Promise<boolean>,transporte:typeof fetch=fetch):Promise<ResultadoEnvio>{
 if(process.env.ATENDIMENTO_ENVIO_HABILITADO!=='true'||process.env.ATENDIMENTO_AUTORIDADE_ENVIO!=='vps')throw Error('ENVIO_DESABILITADO');
 if(!uuid.test(p.id)||!/^\d{8,15}$/.test(p.destinatario)||typeof p.texto!=='string'||!p.texto.trim()||p.texto.length>4096||/[\x00]/.test(p.texto)||(p.respostaA&&!wamid.test(p.respostaA)))throw Error('ENVIO_ENTRADA_INVALIDA');
 if(!/^\d{5,25}$/.test(c.numeroId)||!/^v\d{1,2}\.0$/.test(c.versao)||!c.token||c.token.length>8192||!['homologacao','operacao'].includes(c.modo))throw Error('ENVIO_CONFIGURACAO_INVALIDA');
 if(c.modo==='homologacao'&&!c.destinatariosAutorizados.includes(p.destinatario))throw Error('DESTINATARIO_NAO_AUTORIZADO');
 if(!await revalidar())throw Error('ENVIO_ACESSO_REVOGADO');
 const body=JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:p.destinatario,type:'text',text:{body:p.texto,preview_url:false},...(p.respostaA?{context:{message_id:p.respostaA}}:{})});
 try{
  const r=await transporte(`https://graph.facebook.com/${c.versao}/${c.numeroId}/messages`,{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(30000),cache:'no-store'});
  if(!r.body||r.status>=500||r.status<200||r.status>=300&&r.status<400)return {estado:'incerto',codigo:'META_RESULTADO_DESCONHECIDO'};
  const reader=r.body.getReader(),partes:Uint8Array[]=[];let n=0;
  try{for(;;){const b=await reader.read();if(b.done)break;n+=b.value.byteLength;if(n>65536){await reader.cancel();return {estado:'incerto',codigo:'META_RESULTADO_DESCONHECIDO'};}partes.push(b.value);}}finally{reader.releaseLock();}
  const d:unknown=JSON.parse(Buffer.concat(partes).toString());
  if(!objeto(d))return {estado:'incerto',codigo:'META_RESULTADO_DESCONHECIDO'};
  if(r.ok&&d.messaging_product==='whatsapp'&&Array.isArray(d.messages)&&d.messages.length===1&&objeto(d.messages[0])&&typeof d.messages[0].id==='string'&&wamid.test(d.messages[0].id))return {estado:'aceito',wamid:d.messages[0].id};
  if(!r.ok&&r.status>=400&&r.status<500&&objeto(d.error)&&Number.isSafeInteger(d.error.code)&&Number(d.error.code)>0)return {estado:'recusado',http:r.status,codigo:Number(d.error.code)};
  return {estado:'incerto',codigo:'META_RESULTADO_DESCONHECIDO'};
 }catch{return {estado:'incerto',codigo:'META_RESULTADO_DESCONHECIDO'};}
}

export type DiarioEnvio={
 // Deve gravar em transacao ANTES de autorizar a chamada. ID/hash unicos;
 // tentativa em andamento apos reinicio exige reconciliacao, nao novo envio.
 iniciar:(p:PedidoEnvioTexto)=>Promise<'nova'|'ja_registrada'>;
 concluir:(id:string,r:ResultadoEnvio)=>Promise<void>;
};
export async function processarEnvioTexto(p:PedidoEnvioTexto,c:Configuracao,d:DiarioEnvio,revalidar:()=>Promise<boolean>,transporte:typeof fetch=fetch){
 if(process.env.ATENDIMENTO_ENVIO_HABILITADO!=='true'||process.env.ATENDIMENTO_AUTORIDADE_ENVIO!=='vps')throw Error('ENVIO_DESABILITADO');
 if(!await revalidar())throw Error('ENVIO_ACESSO_REVOGADO');
 if(await d.iniciar(p)!=='nova')return {estado:'reconciliacao_necessaria'} as const;
 const r=await enviarTextoWhatsApp(p,c,revalidar,transporte);
 // Se a gravacao falhar apos aceite, manter intencao duravel: nova execucao nao
 // pode enviar outra vez. Nenhum payload/token/erro da Meta vai para logs.
 await d.concluir(p.id,r);return r;
}
