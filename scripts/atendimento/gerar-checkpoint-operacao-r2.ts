import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,readFile,readdir,open,rename,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {criarCifraBackup} from './backup-r2';
import {criarCheckpointOperacaoR2,extrairCheckpointOperacaoR2,type PlanoCheckpointOperacao} from './checkpoint-operacao-r2';
import {selarSpoolOperacao,publicarSpoolOperacao} from './spool-checkpoint-operacao-r2';
import type {EntradaVerificacaoR2} from './verificacao-r2';
process.umask(0o077);
const estado='/estado/checkpoints-operacao-v2',sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function gravar(nome:string,bytes:Buffer){
 const temporario=join(estado,'.'+randomUUID()+'.parcial'),f=await open(temporario,'wx',0o600);
 try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 await rename(temporario,join(estado,nome));const dir=await open(estado,'r');try{await dir.sync();}finally{await dir.close();}
}
async function fontes(){
 const itens:PlanoCheckpointOperacao['fontes']=[];
 async function visitar(pasta:string){
  const i=await lstat(pasta);if(!i.isDirectory()||i.isSymbolicLink())throw Error('CHECKPOINT_OPERACAO_FONTE_INVALIDA');
  for(const nome of (await readdir(pasta)).sort()){
   if(!/^[a-zA-Z0-9_.-]+$/.test(nome)||['.','..','.git'].includes(nome))throw Error('CHECKPOINT_OPERACAO_FONTE_INVALIDA');
   const caminho=join(pasta,nome),s=await lstat(caminho);
   if(s.isSymbolicLink())throw Error('CHECKPOINT_OPERACAO_FONTE_INVALIDA');
   if(s.isDirectory()){await visitar(caminho);continue;}
   if(!s.isFile()||s.size>64*1024*1024)throw Error('CHECKPOINT_OPERACAO_CAPACIDADE_REQUER_REVISAO');
   const bytes=await readFile(caminho);
   try{itens.push({caminho,destino:'operacao/'+caminho.slice('/entrada/'.length),bytes:bytes.length,sha256:sha(bytes)});}finally{bytes.fill(0);}
  }
 }
 for(const grupo of ['banco','configuracao','release','midia'])await visitar('/entrada/'+grupo);
 return itens;
}
let cifra:ReturnType<typeof criarCifraBackup>|undefined;
async function executar(){
 if(process.platform!=='linux')throw Error('CHECKPOINT_OPERACAO_AMBIENTE_RECUSADO');
 const modo=process.argv[2]??'legado';if(!((modo==='legado'&&process.argv.length===2)||(modo==='--selar-spool'&&process.argv.length===3)||(modo==='--publicar-spool'&&process.argv.length===4&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(process.argv[3]))||(modo==='--registrar-falha'&&process.argv.length===4&&/^CHECKPOINT_OPERACAO_[A-Z_]+$/.test(process.argv[3]))))throw Error('CHECKPOINT_OPERACAO_ARGUMENTO_RECUSADO');
 await mkdir(estado,{recursive:true,mode:0o700});if((await lstat(estado)).isSymbolicLink())throw Error('CHECKPOINT_OPERACAO_ESTADO_RECUSADO');
 // Diagnóstico do preflight: nenhum segredo, banco, rede ou fonte necessário.
 // A tela de status lê o mesmo estado durável e conserva o último sucesso.
 if(modo==='--registrar-falha'){
  let anterior:Record<string,unknown>={};try{anterior=JSON.parse(await readFile(join(estado,'atual.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  await gravar('atual.json',Buffer.from(JSON.stringify({...anterior,emExecucao:false,falha:process.argv[3],ultimaFalha:new Date().toISOString()})));console.error(process.argv[3]);return;
 }
 const s=await lstat('/run/secrets/checkpoint.json');if(!s.isFile()||s.isSymbolicLink()||s.size>16384)throw Error('CHECKPOINT_OPERACAO_CONFIGURACAO_RECUSADA');
 const config=JSON.parse(await readFile('/run/secrets/checkpoint.json','utf8')) as EntradaVerificacaoR2;
 if(modo==='--publicar-spool'){
  const id=process.argv[3],inicioTentativa=new Date().toISOString();let anterior:Record<string,unknown>={};
  try{anterior=JSON.parse(await readFile(join(estado,'atual.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  await gravar('atual.json',Buffer.from(JSON.stringify({...anterior,inicioTentativa,emExecucao:true})));
  try{
   let resultado:Awaited<ReturnType<typeof publicarSpoolOperacao>>|undefined;
   try{const r=JSON.parse(await readFile(join(estado,'checkpoint-'+id+'.json'),'utf8'));if(r.id===id&&r.spoolHorarioPreservado===true&&r.baseExternaIntegralConferida===true){await extrairCheckpointOperacaoR2(config,id,r.referencia.sha256,async()=>undefined);resultado=r;}}
   catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   resultado??=await publicarSpoolOperacao(config,estado,id);
   const recibo={...resultado,inicioTentativa,emExecucao:false,falha:null,ultimaCriacaoBemSucedida:resultado.concluidoEm};
   // Recibo e spool cifrado permanecem preservados também depois do sucesso.
   await gravar('checkpoint-'+id+'.json',Buffer.from(JSON.stringify(recibo)));await gravar('atual.json',Buffer.from(JSON.stringify(recibo)));
   console.log(JSON.stringify({banco:resultado.banco,bancoEntrada:resultado.bancoEntrada,ponto:id,arquivos:resultado.referencia.arquivos,bytes:resultado.referencia.bytesAbertos,concluidoEm:resultado.concluidoEm,restauracaoRealComprovada:false,spoolLocalPreservado:true}));
  }catch(e){const m=(e as Error).message;await gravar('atual.json',Buffer.from(JSON.stringify({...anterior,inicioTentativa,emExecucao:false,falha:/^(CHECKPOINT|BACKUP)_[A-Z_]+$/.test(m)?m:'CHECKPOINT_OPERACAO_INTERROMPIDO',ultimaFalha:new Date().toISOString()})));throw e;}
  return;
 }
 const congelado=JSON.parse(await readFile('/entrada/congelado.json','utf8'));
 if(congelado.versao!==2||congelado.banco!=='donatella_operacao'||congelado.bancoEntrada!=='donatella_entrada'||!/^[a-f0-9-]{36}$/.test(congelado.id)||!Number.isFinite(Date.parse(congelado.criadoEm)))throw Error('CHECKPOINT_OPERACAO_SNAPSHOT_INCOMPLETO');
 if(modo==='--selar-spool'){
  const estagio='/cifra-temporaria';const st=await lstat(estagio);
  if(!st.isDirectory()||st.isSymbolicLink()||(await statfs(estagio)).type!==0x01021994)throw Error('CHECKPOINT_OPERACAO_TMPFS_EXIGIDA');
  const plano:PlanoCheckpointOperacao={versao:2,id:congelado.id,criadoEm:congelado.criadoEm,banco:'donatella_operacao',bancoEntrada:'donatella_entrada',proveniencia:'copia_real_preservada',fontes:await fontes()};
  console.log(JSON.stringify(await selarSpoolOperacao(config,plano,estado,undefined,estagio)));return;
 }
 cifra=criarCifraBackup(config.segredoTrabalho);const nome=congelado.id+'.plano.bin.enc',contexto=congelado.id+'/plano';
 let plano:PlanoCheckpointOperacao;
 try{const b=cifra.abrir(await readFile(join(estado,nome)),contexto);try{plano=JSON.parse(b.toString());}finally{b.fill(0);}}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
  plano={versao:2,id:congelado.id,criadoEm:congelado.criadoEm,banco:'donatella_operacao',bancoEntrada:'donatella_entrada',proveniencia:'copia_real_preservada',fontes:await fontes()};
  const b=Buffer.from(JSON.stringify(plano));try{await gravar(nome,cifra.cifrar(b,contexto));}finally{b.fill(0);}
 }
 if(plano.id!==congelado.id||plano.criadoEm!==congelado.criadoEm||plano.banco!=='donatella_operacao'||plano.bancoEntrada!=='donatella_entrada'||plano.versao!==2)throw Error('CHECKPOINT_OPERACAO_PLANO_DIVERGENTE');
 let anterior:Record<string,unknown>={};
 try{anterior=JSON.parse(await readFile(join(estado,'atual.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const inicioTentativa=new Date().toISOString();await gravar('atual.json',Buffer.from(JSON.stringify({...anterior,inicioTentativa,emExecucao:true})));
 try{
  const prova=await criarCheckpointOperacaoR2(config,plano,estado);
  const resultado={...prova,inicioTentativa,emExecucao:false,falha:null,ultimaCriacaoBemSucedida:prova.concluidoEm};
  await gravar('checkpoint-'+plano.id+'.json',Buffer.from(JSON.stringify(resultado)));await gravar('atual.json',Buffer.from(JSON.stringify(resultado)));
  console.log(JSON.stringify({banco:prova.banco,bancoEntrada:prova.bancoEntrada,ponto:prova.id,arquivos:prova.referencia.arquivos,bytes:prova.referencia.bytesAbertos,concluidoEm:prova.concluidoEm,restauracaoRealComprovada:false}));
 }catch(e){const m=(e as Error).message;await gravar('atual.json',Buffer.from(JSON.stringify({...anterior,inicioTentativa,emExecucao:false,falha:/^(CHECKPOINT|BACKUP)_[A-Z_]+$/.test(m)?m:'CHECKPOINT_OPERACAO_INTERROMPIDO',ultimaFalha:new Date().toISOString()})));throw e;}
}
try{await executar();}catch(e){const m=(e as Error).message;console.error(/^(CHECKPOINT|BACKUP)_[A-Z_]+$/.test(m)?m:'CHECKPOINT_OPERACAO_INTERROMPIDO');process.exitCode=1;}
finally{cifra?.fechar();}
