import {createHash,createHmac} from 'node:crypto';
import {setTimeout as pausar} from 'node:timers/promises';

export type ConfiguracaoS3={endpoint:string;bucket:string;regiao:string;accessKey:string;secretKey:string;prefixo:string};
type Dependencias={requisitar?:typeof fetch;esperar?:(ms:number)=>Promise<unknown>;agora?:()=>Date};
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const hmac=(k:Buffer|string,b:string)=>createHmac('sha256',k).update(b).digest();
const MAXIMO=48*1024*1024; // Cargas atuais <=32 MiB; arquivos maiores usam partes limitadas.
const transitorio=(status:number)=>[408,429,500,502,503,504].includes(status);

/** PUT exclusivo + GET integral. ETag/HEAD/metadata nunca substituem os bytes.
 * Sem DELETE/LIST/ACL nesta interface usada pelo servico. Cada nome e imutavel.
 */
export function criarRepositorioS3(config:ConfiguracaoS3,dependencias:Dependencias={}){
 let endpoint:URL;
 try{endpoint=new URL(config.endpoint);}catch{throw Error('BACKUP_CONFIGURACAO_INVALIDA');}
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/'||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)||config.bucket.includes('..')||!/^[a-z0-9-]{1,40}$/.test(config.regiao)||!/^[a-zA-Z0-9_-]{1,64}(\/[a-zA-Z0-9_-]{1,64})*$/.test(config.prefixo)||config.prefixo.length>128||!config.accessKey||!config.secretKey)throw Error('BACKUP_CONFIGURACAO_INVALIDA');
 const requisitar=dependencias.requisitar??fetch,esperar=dependencias.esperar??pausar,agora=dependencias.agora??(()=>new Date());
 function conferirChave(chave:string){
  if(chave.length>512||!/^([a-z0-9_-]{1,128}\/)*[a-z0-9_-]{1,128}(\.[a-z0-9_-]{1,16}){0,3}$/.test(chave))throw Error('BACKUP_CHAVE_RECUSADA');
 }
 async function chamar(method:'GET'|'PUT',chave:string,body?:Buffer){
  conferirChave(chave);
  const url=new URL(`/${config.bucket}/${config.prefixo}/${chave}`,endpoint);
  const data=agora().toISOString().replace(/[:-]|\.\d{3}/g,''),dia=data.slice(0,8),payload=sha(body??Buffer.alloc(0));
  const cabecalhos=`host:${url.host}\n${method==='PUT'?'if-none-match:*\n':''}x-amz-content-sha256:${payload}\nx-amz-date:${data}\n`;
  const assinados=method==='PUT'?'host;if-none-match;x-amz-content-sha256;x-amz-date':'host;x-amz-content-sha256;x-amz-date',escopo=`${dia}/${config.regiao}/s3/aws4_request`;
  const canonical=`${method}\n${url.pathname}\n\n${cabecalhos}\n${assinados}\n${payload}`;
  const chaveDerivada=hmac(hmac(hmac(hmac('AWS4'+config.secretKey,dia),config.regiao),'s3'),'aws4_request');
  const signature=createHmac('sha256',chaveDerivada).update(`AWS4-HMAC-SHA256\n${data}\n${escopo}\n${sha(canonical)}`).digest('hex');
  chaveDerivada.fill(0);
  // Falhas do fetch sao convertidas em codigos fixos; nenhuma URL/credencial em logs.
  return requisitar(url,{method,redirect:'error',signal:AbortSignal.timeout(120_000),headers:{...(method==='PUT'?{'If-None-Match':'*'}:{}),'x-amz-date':data,'x-amz-content-sha256':payload,Authorization:`AWS4-HMAC-SHA256 Credential=${config.accessKey}/${escopo}, SignedHeaders=${assinados}, Signature=${signature}`},...(body?{body:new Uint8Array(body)}:{})});
 }
 async function ler(chave:string,limite=MAXIMO):Promise<Buffer|null>{
  conferirChave(chave);
  if(!Number.isSafeInteger(limite)||limite<0||limite>MAXIMO)throw Error('BACKUP_VOLUME_RECUSADO');
  for(let tentativa=0;tentativa<4;tentativa++){
   let resposta:Response;
   try{resposta=await chamar('GET',chave);}catch{if(tentativa===3)throw Error('BACKUP_LEITURA_INDISPONIVEL');await esperar(500*2**tentativa);continue;}
   if(resposta.status===404){await resposta.body?.cancel();return null;}
   if(transitorio(resposta.status)){await resposta.body?.cancel();if(tentativa===3)throw Error('BACKUP_LEITURA_INDISPONIVEL');await esperar(500*2**tentativa);continue;}
   if(!resposta.ok||!resposta.body){await resposta.body?.cancel();throw Error('BACKUP_CONFERENCIA_FALHOU');}
   const tamanho=resposta.headers.get('content-length');
   if(tamanho!==null&&(!/^\d+$/.test(tamanho)||BigInt(tamanho)>BigInt(limite))){await resposta.body.cancel();throw Error('BACKUP_DIVERGENTE');}
   const leitor=resposta.body.getReader(),partes:Uint8Array[]=[];let bytes=0;
   try{
    while(true){const r=await leitor.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>limite){await leitor.cancel();throw Error('BACKUP_DIVERGENTE');}partes.push(r.value);}
    if(tamanho!==null&&BigInt(tamanho)!==BigInt(bytes))throw Error('BACKUP_DIVERGENTE');
    return Buffer.concat(partes,bytes);
   }catch(e){
    await leitor.cancel().catch(()=>undefined);
    if((e as Error).message==='BACKUP_DIVERGENTE')throw e;
    if(tentativa===3)throw Error('BACKUP_LEITURA_INDISPONIVEL');
    await esperar(500*2**tentativa);
   }finally{leitor.releaseLock();}
  }
  throw Error('BACKUP_LEITURA_INDISPONIVEL');
 }
 async function preservar(chave:string,conteudo:Buffer){
  conferirChave(chave);
  if(conteudo.length>MAXIMO)throw Error('BACKUP_VOLUME_RECUSADO');
  for(let tentativa=0;tentativa<4;tentativa++){
   // Tambem reconcilia PUT que chegou ao R2 mas perdeu a resposta.
   const existente=await ler(chave,conteudo.length);
   if(existente!==null){try{if(existente.length!==conteudo.length||sha(existente)!==sha(conteudo))throw Error('BACKUP_DIVERGENTE');return {bytes:conteudo.length,sha256:sha(conteudo)};}finally{existente.fill(0);}}
   let resposta:Response|undefined;
   try{resposta=await chamar('PUT',chave,conteudo);}catch{/* A proxima leitura resolve o resultado incerto antes de repetir o PUT exclusivo. */}
   if(resposta){
    await resposta.body?.cancel();
    if(!resposta.ok&&![409,412].includes(resposta.status)&&!transitorio(resposta.status))throw Error('BACKUP_ENVIO_FALHOU');
   }
   // R2 S3 tem read-after-write forte. Depois de 2xx a proxima iteracao
   // rele os bytes imediatamente; recusa/resultado incerto mantem backoff.
   if(tentativa<3){if(!resposta?.ok)await esperar(500*2**tentativa);}
   else{
    const final=await ler(chave,conteudo.length);
    if(final!==null){try{if(final.length!==conteudo.length||sha(final)!==sha(conteudo))throw Error('BACKUP_DIVERGENTE');return {bytes:conteudo.length,sha256:sha(conteudo)};}finally{final.fill(0);}}
   }
  }
  throw Error('BACKUP_ENVIO_FALHOU');
 }
 return {ler,preservar};
}
