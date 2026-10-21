import {createHash} from 'node:crypto';
import type {DocumentoCarga} from '../../src/lib/atendimento/carga';
import {urlObjeto} from './storage-objeto.mjs';

export type VersaoArquivo={id:string;bucket:'whatsapp-media'|'audio-messages';name:string;etag:string;bytes:number;version:string|null;updatedAt:string;identidade:string};
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
function versao(row:Record<string,unknown>):VersaoArquivo|null{
 if(!['whatsapp-media','audio-messages'].includes(String(row.bucket_id)))return null;
 // Normaliza somente metadados de arquivo. Precisao numerica do negocio nao passa aqui.
 const r=JSON.parse(JSON.stringify(row)),metadata=r.metadata;
 if(typeof r.id!=='string'||! /^[a-f0-9-]{36}$/i.test(r.id)||typeof r.name!=='string'||!r.name||r.name.length>2048||r.name.split('/').some((p:string)=>!p||p==='.'||p==='..')||!metadata||typeof metadata.eTag!=='string'||!/^"[a-f0-9]{32}(?:-[1-9][0-9]{0,4})?"$/.test(metadata.eTag)||!Number.isSafeInteger(metadata.size)||metadata.size<0||metadata.size>64*1024*1024||typeof r.updated_at!=='string'||!Number.isFinite(Date.parse(r.updated_at))||(r.version!==null&&r.version!==undefined&&typeof r.version!=='string'))throw Error('ARQUIVO_METADATA_INSUFICIENTE');
 const v={id:r.id,bucket:r.bucket_id,name:r.name,etag:metadata.eTag,bytes:metadata.size,version:r.version??null,updatedAt:r.updated_at};
 return {...v,identidade:hash(JSON.stringify(v))};
}
export function versoesDaTransacao(documento:DocumentoCarga):VersaoArquivo[]{
 if(documento.tipo!=='transacao')return [];
 const unicas=new Map<string,VersaoArquivo>();
 for(const e of documento.eventos)if(e.schema==='storage'&&e.tabela==='objects')for(const r of [e.anterior,e.posterior])if(r){const v=versao(r);if(v)unicas.set(v.identidade,v);}
 return [...unicas.values()];
}

/** A captura registra metadados, nao os bytes. If-Match + ETag nativo + tamanho
 * vinculam a leitura a versao esperada. SHA registra o conteudo efetivamente lido.
 * Versao desaparecida/alterada bloqueia ACK; nada e substituido pelo estado atual.
 */
export async function lerVersaoFisica({origem,credencial,versao:v,requisitar=fetch}:{origem:string;credencial:string;versao:VersaoArquivo;requisitar?:typeof fetch}){
 const url=urlObjeto(origem,{bucket:v.bucket,name:v.name});
 let resposta:Response;
 try{resposta=await requisitar(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(120_000),headers:{apikey:credencial,'If-Match':v.etag,'Accept-Encoding':'identity','Cache-Control':'no-cache'}});}catch{throw Error('ARQUIVO_LEITURA_INDISPONIVEL');}
 if([404,410,412].includes(resposta.status)){await resposta.body?.cancel();throw Error('ARQUIVO_LACUNA_DE_VERSAO');}
 if(!resposta.ok||!resposta.body){await resposta.body?.cancel();throw Error('ARQUIVO_LEITURA_INDISPONIVEL');}
 if(resposta.headers.get('etag')!==v.etag||(resposta.headers.has('content-length')&&resposta.headers.get('content-length')!==String(v.bytes))){await resposta.body.cancel();throw Error('ARQUIVO_LACUNA_DE_VERSAO');}
 const leitor=resposta.body.getReader(),partes:Uint8Array[]=[];let n=0;
 try{while(true){const p=await leitor.read();if(p.done)break;n+=p.value.length;if(n>v.bytes){await leitor.cancel();throw Error('ARQUIVO_LACUNA_DE_VERSAO');}partes.push(p.value);}if(n!==v.bytes)throw Error('ARQUIVO_LACUNA_DE_VERSAO');const bytes=Buffer.concat(partes,n);return {bytes,sha256:hash(bytes)};}
 catch(e){await leitor.cancel().catch(()=>undefined);if((e as Error).message==='ARQUIVO_LACUNA_DE_VERSAO')throw e;throw Error('ARQUIVO_LEITURA_INDISPONIVEL');}finally{leitor.releaseLock();}
}

type Conteudo={bytes:Buffer;sha256:string};
type Destinos={buscarPreservado:(v:VersaoArquivo)=>Promise<Conteudo|null>;lerOrigem:(v:VersaoArquivo)=>Promise<Conteudo>;preservarExterno:(v:VersaoArquivo,c:Conteudo)=>Promise<{referencia:string}>;registrar:(v:VersaoArquivo,c:Conteudo,ref:string)=>Promise<void>};
/** Versoes anterior e posterior preservadas e registradas antes do retorno ao
 * arquivador do grupo. DELETE preserva o passado, jamais apaga arquivos de backup.
 */
export async function preservarArquivosDaTransacao(documento:DocumentoCarga,destinos:Destinos){
 let preservadas=0;
 for(const v of versoesDaTransacao(documento)){
  const c=await destinos.buscarPreservado(v)??await destinos.lerOrigem(v);
  try{
   if(c.bytes.length!==v.bytes||hash(c.bytes)!==c.sha256)throw Error('ARQUIVO_PRESERVADO_DIVERGENTE');
   const ref=await destinos.preservarExterno(v,c);if(!ref||typeof ref.referencia!=='string'||!ref.referencia)throw Error('ARQUIVO_EXTERNO_NAO_COMPROVADO');
   await destinos.registrar(v,c,ref.referencia);preservadas++;
  }finally{c.bytes.fill(0);}
 }
 return {versoesPreservadas:preservadas};
}
