import {createHash,randomUUID} from 'node:crypto';
import {open,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {urlObjeto} from './backup-arquivos.mjs';

// ETags multipart não são necessariamente MD5. Conferir bytes + ETag HTTP nativo.
async function main() {
  const root=resolve(process.argv[2]);
  const snapshot=JSON.parse(await readFile(join(root,'banco/storage-export-privado.json'),'utf8'));
  const records=(await readFile(join(root,'midia/manifesto-inicial.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const rows=new Map(records.map(row=>[`${row.bucket}/${row.name}`,row]));
  const objects=snapshot.objetos.filter(o=>/^"[a-f0-9]{32}-[1-9][0-9]{0,4}"$/.test(o.metadata.eTag));
  if(objects.length!==2) throw new Error('ESCOPO_ETAG_DIVERGENTE');
  const provas=[];
  for(const obj of objects) {
    const row=rows.get(`${obj.bucket}/${obj.name}`);
    const response=await fetch(urlObjeto(process.env.ATENDIMENTO_ORIGEM_URL,obj),{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(120000),
      headers:{apikey:process.env.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY,'Accept-Encoding':'identity','Cache-Control':'no-cache'},
    });
    if(!response.ok||!response.body) throw new Error('LEITURA_ETAG_FALHOU');
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of response.body) {
      bytes+=chunk.length;if(bytes>256*1024*1024)throw new Error('OBJETO_MUITO_GRANDE');hash.update(chunk);
    }
    const prova={id:obj.id,bucket:obj.bucket,name:obj.name,etagEsperado:obj.metadata.eTag,
      etagRecebido:response.headers.get('etag'),bytes,sha256:hash.digest('hex'),time:new Date().toISOString()};
    prova.coincide=Boolean(row&&prova.etagRecebido===prova.etagEsperado&&bytes===row.bytes&&bytes===obj.metadata.size&&prova.sha256===row.sha256);
    provas.push(prova);
  }
  const output=await open(join(root,'midia',`conferencia-etags-${randomUUID()}.json`),'wx',0o600);
  try{await output.writeFile(JSON.stringify({provas}));await output.sync();}finally{await output.close();}
  console.log(JSON.stringify({etagsConferidos:provas.length,coincidentes:provas.filter(p=>p.coincide).length}));
  if(provas.some(p=>!p.coincide))throw new Error('ETAG_OU_BYTES_DIVERGENTES');
}
main().catch(()=>{console.error('CONFERENCIA_ETAG_INCOMPLETA: evidência privada preservada.');process.exitCode=1;});
