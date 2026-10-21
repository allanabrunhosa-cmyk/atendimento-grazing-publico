import {createHash,randomUUID} from 'node:crypto';
import {lstat,open,readFile,link,unlink} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';

/** Publica somente conteúdo verificado, sem substituir CAS existente. O vínculo
 * atômico só expõe bytes depois do fsync; a confirmação espera o fsync da pasta. */
export async function publicarMidiaChat(raiz:string,hash:string,bytes:Buffer){
 if(resolve(raiz)!==raiz||!/^[a-f0-9]{64}$/.test(hash)||bytes.length>64*1024*1024||createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('CHAT_MINIMO_CAS_CONTEUDO_RECUSADO');
 for(let p=raiz;;p=dirname(p)){const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('CHAT_MINIMO_CAS_CAMINHO_RECUSADO');if(p===dirname(p))break;}
 const destino=join(raiz,hash),temporario=join(raiz,'.chat-'+randomUUID()+'.tmp'),f=await open(temporario,'wx',0o600);
 try{
  await f.writeFile(bytes);await f.sync();await f.close();
  try{await link(temporario,destino);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  const s=await lstat(destino);
  if(!s.isFile()||s.isSymbolicLink()||s.size!==bytes.length||createHash('sha256').update(await readFile(destino)).digest('hex')!==hash)throw Error('CHAT_MINIMO_CAS_EXISTENTE_DIVERGENTE');
  if(process.platform!=='win32'){const d=await open(raiz,'r');try{await d.sync();}finally{await d.close();}}
  return {hash,bytes:bytes.length};
 }finally{await f.close().catch(()=>undefined);await unlink(temporario);}
}
