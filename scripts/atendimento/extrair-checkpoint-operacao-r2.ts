import {randomUUID} from 'node:crypto';
import {lstat,mkdir,open,readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {extrairCheckpointOperacaoR2} from './checkpoint-operacao-r2';
import {recuperarBancoParticionado} from './checkpoint-r2';
import type {EntradaVerificacaoR2} from './verificacao-r2';

process.umask(0o077);
/** Executar apenas no contêiner isolado de recuperação, com /recuperacao privado.
 * A configuração contém a chave de trabalho do serviço; nunca a chave mestra.
 * SQL, jobs e envios não são executados por esta etapa de extração. */
async function executar(){
 const [id,digest]=process.argv.slice(2);
 if(process.argv.length!==4||!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9]{64}$/.test(digest))throw Error('CHECKPOINT_OPERACAO_ARGUMENTO_RECUSADO');
 const raiz='/recuperacao',configPath=join(raiz,'config.json'),s=await lstat(configPath);
 if(!s.isFile()||s.isSymbolicLink()||s.size>16384)throw Error('CHECKPOINT_OPERACAO_CONFIGURACAO_RECUSADA');
 const entrada=JSON.parse(await readFile(configPath,'utf8')) as EntradaVerificacaoR2;
 const destino=join(raiz,id);await mkdir(destino,{mode:0o700});
 async function gravar(nome:string,b:Buffer){
  const p=resolve(destino,nome);
  if(!p.startsWith(destino+'/')||nome.split('/').some(n=>n==='.'||n==='..')||!/^[a-zA-Z0-9_./-]+$/.test(nome))throw Error('CHECKPOINT_OPERACAO_DESTINO_RECUSADO');
  await mkdir(dirname(p),{recursive:true,mode:0o700});
  const f=await open(p,'wx',0o600);try{await f.writeFile(b);await f.sync();}finally{await f.close();}
 }
 const inicio=Date.now(),prova=await extrairCheckpointOperacaoR2(entrada,id,digest,gravar);
 if(!prova.coberturaEntrada||prova.banco!=='donatella_operacao'||prova.bancoEntrada!=='donatella_entrada')throw Error('CHECKPOINT_OPERACAO_ENTRADA_NAO_COBERTA');
 const bancos=[];
 for(const nome of ['operacao','entrada'] as const){
  const pasta=join(destino,'operacao/banco'),arquivo=nome+'.backup' as 'operacao.backup'|'entrada.backup',f=await open(join(pasta,arquivo),'wx',0o600);
  try{const banco=await recuperarBancoParticionado(await readFile(join(pasta,nome+'.indice.json')),n=>readFile(join(pasta,n)),async b=>{await f.writeFile(b);},arquivo);await f.sync();bancos.push({nome:'donatella_'+nome,...banco});}finally{await f.close();}
 }
 const resultado={versao:2,id,manifestoSha256:digest,proveniencia:prova.proveniencia,bancos,cacheLocalUsado:false,origemUsada:false,restauracaoRealComprovada:false,extraidaEm:new Date().toISOString(),duracaoExtracaoSegundos:Math.ceil((Date.now()-inicio)/1000)};
 await gravar('extracao.json',Buffer.from(JSON.stringify(resultado)));
 console.log(JSON.stringify({...resultado,marcador:randomUUID()}));
}
executar().catch(e=>{const m=(e as Error).message;console.error(/^(CHECKPOINT|BACKUP)_[A-Z_]+$/.test(m)?m:'CHECKPOINT_OPERACAO_EXTRACAO_INTERROMPIDA');process.exitCode=1;});
