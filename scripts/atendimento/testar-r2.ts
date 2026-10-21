import {createHash,createHmac,randomUUID} from 'node:crypto';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';

/** Sonda separada do transporte de servico. PUT sem condicao e DELETE existem
 * SOMENTE aqui e somente para um UUID novo no prefixo de bytes ficticios.
 * Nunca recebe nomes existentes de backup nem permite administrar buckets.
 */
export async function testarPermissoesR2(config:ConfiguracaoS3,protegido=false){
 if(config.prefixo!=='donatella-v2'||config.bucket!=='grazing-donatella-backups')throw Error('R2_SONDA_FORA_DO_ESCOPO');
 const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
 const hmac=(k:Buffer|string,b:string)=>createHmac('sha256',k).update(b).digest();
 const id=randomUUID(),prefixo=`${config.prefixo}/${protegido?'inicial/':''}testes/${id}`,chave=`${prefixo}/ficticio.bin.enc`,origem=Buffer.from('SONDA FICTICIA DONATELLA R2 '+id),outro=Buffer.from('SONDA FICTICIA DIFERENTE '+id);
 const repo=criarRepositorioS3({...config,prefixo});
 await repo.preservar('ficticio.bin.enc',origem);await repo.preservar('ficticio.bin.enc',origem);
 let divergenciaRecusada=false;
 try{await repo.preservar('ficticio.bin.enc',outro);}catch(e){if((e as Error).message!=='BACKUP_DIVERGENTE')throw e;divergenciaRecusada=true;}
 if(!divergenciaRecusada)throw Error('R2_SONDA_DIVERGENCIA_NAO_RECUSADA');
 async function raw(method:'PUT'|'DELETE',body?:Buffer,condicional=false){
  if(!/^donatella-v2\/(?:inicial\/)?testes\/[a-f0-9-]{36}\/ficticio\.bin\.enc$/.test(chave))throw Error('R2_SONDA_FORA_DO_ESCOPO');
  const url=new URL(`/${config.bucket}/${chave}`,config.endpoint),data=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),dia=data.slice(0,8),payload=sha(body??Buffer.alloc(0));
  const headers=`host:${url.host}\n${condicional?'if-none-match:*\n':''}x-amz-content-sha256:${payload}\nx-amz-date:${data}\n`,assinados=condicional?'host;if-none-match;x-amz-content-sha256;x-amz-date':'host;x-amz-content-sha256;x-amz-date',escopo=`${dia}/${config.regiao}/s3/aws4_request`,canonical=`${method}\n${url.pathname}\n\n${headers}\n${assinados}\n${payload}`;
  const k=hmac(hmac(hmac(hmac('AWS4'+config.secretKey,dia),config.regiao),'s3'),'aws4_request');const assinatura=createHmac('sha256',k).update(`AWS4-HMAC-SHA256\n${data}\n${escopo}\n${sha(canonical)}`).digest('hex');k.fill(0);
  let resposta:Response;try{resposta=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{...(condicional?{'If-None-Match':'*'}:{}),'x-amz-date':data,'x-amz-content-sha256':payload,Authorization:`AWS4-HMAC-SHA256 Credential=${config.accessKey}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}`},...(body?{body:new Uint8Array(body)}:{})});}catch{throw Error('R2_SONDA_INDISPONIVEL');}
  await resposta.body?.cancel();return resposta.status;
 }
 // Bucket lock pode recusar com 403/409 antes de avaliar If-None-Match. A recusa
 // so e aceita na sonda protegida e apos reler o conteudo original intacto.
 const condicional=await raw('PUT',outro,true);
 if(condicional!==412&&!(protegido&&[403,409].includes(condicional)))throw Object.assign(Error('R2_SONDA_CONDICAO_DIVERGENTE'),{http:condicional});
 const aposCondicao=await repo.ler('ficticio.bin.enc');if(!aposCondicao?.equals(origem))throw Error('R2_SONDA_CONDICAO_DIVERGENTE');
 const overwrite=await raw('PUT',outro),bytes=await repo.ler('ficticio.bin.enc');
 const sobrescritaPermitida=overwrite>=200&&overwrite<300&&bytes?.equals(outro)===true;
 if(!sobrescritaPermitida&&!bytes?.equals(origem))throw Error('R2_SONDA_SOBRESCRITA_INCERTA');
 const exclusao=await raw('DELETE'),depois=await repo.ler('ficticio.bin.enc');
 const exclusaoPermitida=exclusao>=200&&exclusao<300&&depois===null;
 if(!exclusaoPermitida&&!depois?.equals(sobrescritaPermitida?outro:origem))throw Error('R2_SONDA_EXCLUSAO_INCERTA');
 if(protegido&&(sobrescritaPermitida||exclusaoPermitida))throw Error('R2_PROTECAO_NAO_COMPROVADA');
 return {teste:'somente_bytes_ficticios',modo:protegido?'protecao':'acesso',prefixo,leituraIntegralConferida:true,duplicidadeSemSobrescrita:true,divergenciaRecusada,putCondicionalStatus:condicional,sobrescritaStatus:overwrite,sobrescritaPermitida,exclusaoStatus:exclusao,exclusaoPermitida,verificadoEm:new Date().toISOString()};
}
