import { open, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { urlObjeto } from './backup-arquivos.mjs';

// API Storage serializa Date em milissegundos/Z; pg_dump conserva micros/+00:00.
// Não substituir timestamps originais por essa representação de conferência.
export function mesmoInstanteStorage(a,b) {
  const first=Date.parse(a); const second=Date.parse(b);
  if(!Number.isFinite(first)||!Number.isFinite(second)) throw new Error('LISTAGEM_TIMESTAMP_INVALIDO');
  return first===second;
}

/** Listagem V2 plana/paginada do SDK existente. Somente leitura; não instala captura. */
export async function listarStorageAtual({origem,chavePublica,bucket,fetchImpl=fetch}) {
  const base=urlObjeto(origem,{bucket,name:'validacao'}).origin;
  const headers={apikey:chavePublica,'Content-Type':'application/json'};
  if(chavePublica.startsWith('eyJ')) headers.Authorization=`Bearer ${chavePublica}`;
  const objects=[]; const ids=new Set(); const cursors=new Set(); let cursor;
  for(let page=0;page<100;page++) {
    const response=await fetchImpl(new URL(`/storage/v1/object/list-v2/${bucket}`,base),{
      method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(30000),
      body:JSON.stringify({limit:1000,with_delimiter:false,sortBy:{column:'name',order:'asc'},...(cursor?{cursor}:{})}),
    });
    if(!response.ok) throw new Error(`LISTAGEM_HTTP_${response.status}`);
    const data=await response.json();
    if(!Array.isArray(data.objects) || typeof data.hasNext!=='boolean' || data.objects.length>1000 || data.folders?.length) throw new Error('LISTAGEM_FORMATO_INVALIDO');
    for(const obj of data.objects) {
      if(typeof obj.id!=='string' || ids.has(obj.id) || typeof obj.name!=='string' || typeof obj.updated_at!=='string') throw new Error('LISTAGEM_INCONSISTENTE');
      ids.add(obj.id); objects.push(obj);
    }
    if(!data.hasNext) return objects;
    if(!data.objects.length || typeof data.nextCursor!=='string' || !data.nextCursor || cursors.has(data.nextCursor)) throw new Error('LISTAGEM_CURSOR_INVALIDO');
    cursor=data.nextCursor; cursors.add(cursor);
  }
  throw new Error('LISTAGEM_LIMITE_EXCEDIDO');
}

async function executar() {
  const root=resolve(process.argv[2]??'');
  const original=JSON.parse(await readFile(join(root,'banco/storage-export-privado.json'),'utf8'));
  const objetoPorId=new Map(original.objetos.map(o=>[o.id,o]));
  const objetos=[];
  for(const bucket of ['whatsapp-media','audio-messages']) {
    const values=await listarStorageAtual({origem:process.env.ATENDIMENTO_ORIGEM_URL,chavePublica:process.env.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY,bucket});
    if(!values.length && original.objetos.some(o=>o.bucket===bucket)) throw new Error('LISTAGEM_VAZIA_NAO_COMPROVA_REMOCOES');
    const known=values.filter(v=>objetoPorId.has(v.id));
    const nameMatches=known.filter(v=>v.name===objetoPorId.get(v.id).name).length;
    const keyMatches=known.filter(v=>v.key===objetoPorId.get(v.id).name).length;
    if(known.length && Math.max(nameMatches,keyMatches)!==known.length) throw new Error('LISTAGEM_CAMINHOS_INCONSISTENTES');
    const useKey=keyMatches>nameMatches;
    for(const obj of values) {
      const item={id:obj.id,bucket,name:useKey?obj.key:obj.name,metadata:obj.metadata,createdAt:obj.created_at,updatedAt:obj.updated_at,version:obj.version??null};
      urlObjeto(process.env.ATENDIMENTO_ORIGEM_URL,item); objetos.push(item);
    }
  }
  const atuais=new Map(objetos.map(o=>[o.id,o]));
  const novos=objetos.filter(o=>!objetoPorId.has(o.id));
  const alterados=objetos.filter(o=>{
    const old=objetoPorId.get(o.id);
    return old && (old.name!==o.name || old.bucket!==o.bucket || !mesmoInstanteStorage(old.updatedAt,o.updatedAt) || old.metadata?.eTag!==o.metadata?.eTag || Number(old.metadata?.size)!==Number(o.metadata?.size));
  });
  const ausentes=original.objetos.filter(o=>!atuais.has(o.id));
  const result={time:new Date().toISOString(),buckets:original.buckets,objetos,comparacaoComExport:{novos,alterados,ausentes},precisaoTimestampListagem:'milissegundos; timestamp original preservado no export',capturaAvaliadaNestaListagem:false};
  const output=await open(join(root,'banco',`storage-live-${randomUUID()}.json`),'wx',0o600);
  try { await output.writeFile(JSON.stringify(result)); await output.sync(); } finally { await output.close(); }
  console.log(JSON.stringify({listagemAtual:objetos.length,novos:novos.length,alterados:alterados.length,ausentes:ausentes.length,capturaAvaliadaNestaListagem:false}));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  executar().catch(error=>{console.error(/^LISTAGEM_[A-Z0-9_]+$/.test(error.message)?error.message:'LISTAGEM_PRIVADA_INTERROMPIDA');process.exitCode=1;});
}
