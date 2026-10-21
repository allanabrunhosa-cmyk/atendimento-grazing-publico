import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,readdir,lstat,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {criarCifraBackup} from './backup-r2';
import {criarCheckpointR2,type PlanoCheckpoint} from './checkpoint-r2';
import type {EntradaVerificacaoR2} from './verificacao-r2';

process.umask(0o077);
const estado='/estado/checkpoints-v2',hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function gravar(nome:string,b:Buffer){
 const parcial=estado+'/.'+randomUUID()+'.parcial',f=await open(parcial,'wx',0o600);
 try{await f.writeFile(b);await f.sync();}finally{await f.close();}
 await rename(parcial,estado+'/'+nome);const d=await open(estado,'r');try{await d.sync();}finally{await d.close();}
}
async function fontes(){
 const fs:PlanoCheckpoint['fontes']=[];
 async function visitar(pasta:string,raiz:string,prefixo:string,somenteConteudos=false){
  const s=await lstat(pasta);if(!s.isDirectory()||s.isSymbolicLink())throw Error('CHECKPOINT_FONTE_RECUSADA');
  for(const nome of (await readdir(pasta)).sort()){
   if(somenteConteudos&&!/^[a-f0-9]{64}\.bin$/.test(nome)){
    if(/^\.[a-f0-9-]{36}\.parcial$/.test(nome))continue;
    throw Error('CHECKPOINT_CONTEUDO_RECUSADO');
   }
   if(!/^[a-zA-Z0-9_.-]+$/.test(nome)||nome==='.'||nome==='..'||nome==='.git')throw Error('CHECKPOINT_FONTE_RECUSADA');
   const caminho=join(pasta,nome),i=await lstat(caminho);
   if(i.isSymbolicLink())throw Error('CHECKPOINT_FONTE_RECUSADA');
   if(i.isDirectory()){await visitar(caminho,raiz,prefixo);continue;}
   if(!i.isFile()||i.size>64*1024*1024)throw Error('CHECKPOINT_CAPACIDADE_REQUER_REVISAO');
   const b=await readFile(caminho);try{const sha256=hash(b);if(somenteConteudos&&nome!==sha256+'.bin')throw Error('CHECKPOINT_CONTEUDO_DIVERGENTE');fs.push({caminho,destino:prefixo+caminho.slice(raiz.length+1),bytes:b.length,sha256});}finally{b.fill(0);}
  }
 }
 for(const g of ['banco','configuracao','release'])await visitar('/entrada/'+g,'/entrada','novos/');
 try{await visitar('/incrementais/arquivos/conteudos','/incrementais/arquivos/conteudos','novos/midia/',true);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 return fs;
}
let cifra:ReturnType<typeof criarCifraBackup>|undefined;
try{
 if(process.argv.length!==2)throw Error('CHECKPOINT_ARGUMENTO_RECUSADO');
 const s=await lstat('/run/secrets/checkpoint.json');if(!s.isFile()||s.isSymbolicLink()||s.size>16384)throw Error('CHECKPOINT_CONFIGURACAO_RECUSADA');
 const config=JSON.parse(await readFile('/run/secrets/checkpoint.json','utf8')) as EntradaVerificacaoR2;
 const entrada=JSON.parse(await readFile('/entrada/congelado.json','utf8'));
 if(entrada.versao!==1||!/^[a-f0-9-]{36}$/.test(entrada.id)||!Number.isFinite(Date.parse(entrada.criadoEm)))throw Error('CHECKPOINT_SNAPSHOT_NAO_CONGELADO');
 await mkdir(estado,{recursive:true,mode:0o700});if((await lstat(estado)).isSymbolicLink())throw Error('CHECKPOINT_ESTADO_RECUSADO');
 cifra=criarCifraBackup(config.segredoTrabalho);
 const planoNome=entrada.id+'.plano.bin.enc',contexto=entrada.id+'/plano';let plano:PlanoCheckpoint;
 try{const b=cifra.abrir(await readFile(estado+'/'+planoNome),contexto);try{plano=JSON.parse(b.toString());}finally{b.fill(0);}}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;plano={versao:1,id:entrada.id,criadoEm:entrada.criadoEm,proveniencia:'copia_real_preservada',fontes:await fontes()};await gravar(planoNome,cifra.cifrar(Buffer.from(JSON.stringify(plano)),contexto));}
 if(plano.id!==entrada.id||plano.criadoEm!==entrada.criadoEm)throw Error('CHECKPOINT_PLANO_DIVERGENTE');
 let anterior:Record<string,unknown>={};
 try{anterior=JSON.parse(await readFile(estado+'/atual.json','utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const inicio=new Date().toISOString();await gravar('atual.json',Buffer.from(JSON.stringify({...anterior,emExecucao:true,inicioTentativa:inicio,pontoEmExecucao:plano.id})));
 try{
  const prova=await criarCheckpointR2(config,plano,estado);
  const resultado={...prova,emExecucao:false,inicioTentativa:inicio,falha:null,ultimaCriacaoBemSucedida:prova.concluidoEm,pontoProtegidoAte:new Date(Date.parse(prova.criadoEm)+90*86400_000).toISOString(),protecaoCondicionadaRegrasAdministrativas:true};
  await gravar('checkpoint-'+plano.id+'.json',Buffer.from(JSON.stringify(resultado)));await gravar('atual.json',Buffer.from(JSON.stringify(resultado)));
  console.log(JSON.stringify({ponto:prova.id,arquivos:prova.referencia.arquivos,bytes:prova.referencia.bytesAbertos,concluidoEm:prova.concluidoEm,restauracaoRealComprovada:false}));
 }catch(e){const m=(e as Error).message;await gravar('atual.json',Buffer.from(JSON.stringify({...anterior,emExecucao:false,inicioTentativa:inicio,pontoEmExecucao:plano.id,falha:/^(CHECKPOINT|BACKUP)_[A-Z_]+$/.test(m)?m:'CHECKPOINT_INTERROMPIDO',ultimaFalha:new Date().toISOString()})));throw e;}
}catch(e){const m=(e as Error).message;console.error(/^(CHECKPOINT|BACKUP)_[A-Z_]+$/.test(m)?m:'CHECKPOINT_INTERROMPIDO');process.exitCode=1;}
finally{cifra?.fechar();}
