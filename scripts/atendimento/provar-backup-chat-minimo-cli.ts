import {createHash,randomUUID} from 'node:crypto';
import {lstat,open,readFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {provarBackupEntradaChat} from './provar-backup-chat-minimo';
import type {EntradaVerificacaoR2} from './verificacao-r2';
process.umask(0o077);
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function privado(p:string,max=32768){
 const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.size>max||resolve(p)!==p)throw Error('CHAT_MINIMO_ARQUIVO_PRIVADO_RECUSADO');
 return readFile(p);
}
async function executar(){
 const [janela,id,digest]=process.argv.slice(2),uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
 if(process.platform!=='linux'||process.argv.length!==5||!uuid.test(janela)||!uuid.test(id)||!/^[a-f0-9]{64}$/.test(digest))throw Error('CHAT_MINIMO_ARGUMENTO_RECUSADO');
 const pasta='/janela',s=await lstat(pasta);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0)throw Error('CHAT_MINIMO_PASTA_PRIVADA_RECUSADA');
 const cfg=JSON.parse((await privado('/run/secrets/checkpoint.json')).toString()) as EntradaVerificacaoR2;
 const manifesto=await readFile('/release/release.json'),runtimeSha256=sha(await readFile('/release/operacao.mjs'));
 if(JSON.parse(manifesto.toString()).runtimeSha256!==runtimeSha256)throw Error('CHAT_MINIMO_RELEASE_DIVERGENTE');
 const prova=await provarBackupEntradaChat(cfg,id,digest,{janelaId:janela,runtimeSha256,manifestoSha256:sha(manifesto)}),bytes=Buffer.from(JSON.stringify(prova));
 const nome='backup-entrada-'+id+'-'+randomUUID()+'.json',f=await open(join(pasta,nome),'wx',0o600);
 try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 const temporario=join(pasta,'.backup-'+randomUUID()+'.tmp'),t=await open(temporario,'wx',0o600);
 try{await t.writeFile(bytes);await t.sync();}finally{await t.close();}
 await rename(temporario,join(pasta,'backup-entrada.json'));const d=await open(pasta,'r');try{await d.sync();}finally{await d.close();}
 console.log(JSON.stringify({tipo:prova.tipo,checkpointId:id,artefatosRelidos:prova.r2.artefatos.length,provaSha256:sha(bytes),restauracaoRealComprovada:false}));
}
executar().catch(e=>{const m=(e as Error).message;console.error(/^(CHAT_MINIMO|CHECKPOINT|BACKUP)_[A-Z_]+$/.test(m)?m:'CHAT_MINIMO_PROVA_BACKUP_INTERROMPIDA');process.exitCode=1;});
