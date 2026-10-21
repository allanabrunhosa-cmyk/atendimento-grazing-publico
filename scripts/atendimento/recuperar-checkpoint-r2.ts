import {extrairCheckpointR2,recuperarBancoParticionado} from './checkpoint-r2';
import {mkdir,readFile,open,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,sep} from 'node:path';
process.umask(0o077);
// Montagens privadas: configuracao minima, referencia concluida e destino novo.
// Extracao nao substitui restauracao PostgreSQL nem abertura da custodia externa.
async function executar(){
if(process.argv.length!==2)throw Error('RECUPERACAO_ARGUMENTO_RECUSADO');
const cfg=JSON.parse(await readFile('/run/secrets/checkpoint.json','utf8'));
const p=JSON.parse(await readFile('/prova/atual.json','utf8'));
if(p.emExecucao||p.falha||!p.id||!p.referencia?.sha256)throw Error('RECUPERACAO_PONTO_NAO_CONCLUIDO');
const raiz='/saida/recuperado',hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
await mkdir(raiz,{recursive:true,mode:0o700});
async function receber(nome:string,b:Buffer){
 const caminho=resolve(raiz,nome);if(!caminho.startsWith(raiz+sep)||nome.split('/').some(n=>['.','..','.git'].includes(n)))throw Error('RECUPERACAO_CAMINHO_RECUSADO');
 await mkdir(dirname(caminho),{recursive:true,mode:0o700});
 try{const st=await lstat(caminho);if(st.isSymbolicLink()||!st.isFile()||st.size!==b.length||hash(await readFile(caminho))!==hash(b))throw Error('RECUPERACAO_BYTES_DIVERGENTES');return;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const f=await open(caminho,'wx',0o600);try{await f.writeFile(b);await f.sync();}finally{await f.close();}
}
const resultado=await extrairCheckpointR2(cfg,p.id,p.referencia.sha256,receber);
const indice=await readFile(raiz+'/novos/banco/preparacao.indice.json'),inteiro='/saida/preparacao-recuperada.backup';
const f=await open(inteiro,'wx',0o600);let banco;
try{banco=await recuperarBancoParticionado(indice,n=>readFile(raiz+'/novos/banco/'+n),async b=>{await f.writeFile(b);});await f.sync();}finally{await f.close();}
const prova={ponto:p.id,referencia:p.referencia,extracaoExclusivamenteR2:true,cacheLocalDaBaseUsado:false,resultado,banco,restauracaoPostgreSQLExecutada:false,concluidoEm:new Date().toISOString()};
const o=await open('/saida/extracao-real.json','wx',0o600);try{await o.writeFile(JSON.stringify(prova));await o.sync();}finally{await o.close();}
console.log(JSON.stringify({ponto:p.id,arquivos:resultado.arquivos,bytes:resultado.bytes,bancoBytes:banco.bytes,extracaoExclusivamenteR2:true,restauracaoPostgreSQLExecutada:false}));
}
try{await executar();}catch(e){
 const codigo=(e as Error).message;
 console.error(/^(RECUPERACAO|CHECKPOINT|BACKUP)_[A-Z_]+$/.test(codigo)?codigo:'RECUPERACAO_INTERROMPIDA');process.exitCode=1;
}
