import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';
import {criarCifraBackup,criarPreservadorPacote,recuperarPacoteR2,type ManifestoBackup} from './backup-r2';
import {recuperarBancoParticionado,validarFonte} from './checkpoint-r2';
import type {EntradaVerificacaoR2} from './verificacao-r2';
import {COBERTURA_BACKUP_OPERACAO} from '../../src/lib/atendimento/prontidao-backup-operacao';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const prefixo='donatella-v2/incrementais/operacao';
type Repositorio=ReturnType<typeof criarRepositorioS3>;
export type PlanoCheckpointOperacao={versao:2;id:string;criadoEm:string;
  banco:'donatella_operacao'|'donatella_ensaio_backup';bancoEntrada:'donatella_entrada'|'donatella_ensaio_entrada_backup';proveniencia:'copia_real_preservada'|'ensaio_ficticio';
  fontes:{caminho:string;destino:string;bytes:number;sha256:string}[]};
function validar(p:PlanoCheckpointOperacao){
 if(p.versao!==2||!uuid.test(p.id)||!Number.isFinite(Date.parse(p.criadoEm))||!p.fontes.length||p.fontes.length>9000
   ||!((p.banco==='donatella_operacao'&&p.bancoEntrada==='donatella_entrada'&&p.proveniencia==='copia_real_preservada')||(p.banco==='donatella_ensaio_backup'&&p.bancoEntrada==='donatella_ensaio_entrada_backup'&&p.proveniencia==='ensaio_ficticio')))throw Error('CHECKPOINT_OPERACAO_PLANO_INVALIDO');
 const destinos=new Set<string>();let total=0;
 for(const f of p.fontes){
  if(resolve(f.caminho)!==f.caminho||!/^operacao\/(banco|configuracao|release|midia)\/([a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(f.destino)
    ||f.destino.split('/').some(n=>n==='.'||n==='..')||destinos.has(f.destino)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('CHECKPOINT_OPERACAO_FONTE_INVALIDA');
  destinos.add(f.destino);total+=f.bytes;
 }
 if(total>2*1024*1024*1024)throw Error('CHECKPOINT_OPERACAO_CAPACIDADE_REQUER_REVISAO');
 if(!destinos.has('operacao/banco/operacao.indice.json')||!destinos.has('operacao/banco/entrada.indice.json')||!destinos.has('operacao/configuracao/cobertura.json')||![...destinos].some(n=>n.startsWith('operacao/release/')))throw Error('CHECKPOINT_OPERACAO_COBERTURA_AUSENTE');
}
async function fonteBytes(f:PlanoCheckpointOperacao['fontes'][number]){
 await validarFonte(f.caminho);const s=await lstat(f.caminho);
 if(!s.isFile()||s.isSymbolicLink()||s.size!==f.bytes)throw Error('CHECKPOINT_OPERACAO_FONTE_ALTERADA');
 const b=await readFile(f.caminho);if(sha(b)!==f.sha256){b.fill(0);throw Error('CHECKPOINT_OPERACAO_FONTE_ALTERADA');}return b;
}
/** Ponto independente do BANCO DE OPERAÇÃO, separado da preparação histórica.
 * Fontes congeladas e partes cifradas duráveis antes de PUT; nenhuma chave mestra.
 * Publicar manifesto/referência só depois de reler integralmente os bytes externos.
 */
export async function criarCheckpointOperacaoR2(entrada:EntradaVerificacaoR2,plano:PlanoCheckpointOperacao,estagio:string,criarRepo:(c:ConfiguracaoS3)=>Repositorio=criarRepositorioS3){
 validar(plano);
 const cobertura=await fonteBytes(plano.fontes.find(f=>f.destino==='operacao/configuracao/cobertura.json')!);
 try{
  const c=JSON.parse(cobertura.toString());
  if(plano.proveniencia==='ensaio_ficticio'){if(c.somenteFicticio!==true)throw Error('CHECKPOINT_OPERACAO_COBERTURA_AUSENTE');}
  else if(c.versao!==2||c.banco!=='donatella_operacao'||c.bancoEntrada!=='donatella_entrada'||c.entradaDuravelSeparada!==true||c.arquivosImutaveis!==true||c.exclusaoArquivosBloqueada!==true||!Array.isArray(c.cobertura)||COBERTURA_BACKUP_OPERACAO.some(n=>!c.cobertura.includes(n)))throw Error('CHECKPOINT_OPERACAO_COBERTURA_AUSENTE');
 }finally{cobertura.fill(0);}
 for(const nomeBanco of ['operacao','entrada'] as const){
  const indice=plano.fontes.find(f=>f.destino==='operacao/banco/'+nomeBanco+'.indice.json')!;
  const indiceBytes=await fonteBytes(indice);let primeira=true;
  try{await recuperarBancoParticionado(indiceBytes,async nome=>{
   const f=plano.fontes.find(f=>f.destino==='operacao/banco/'+nome);if(!f)throw Error('CHECKPOINT_OPERACAO_PARTE_AUSENTE');
   return fonteBytes(f);
  },async b=>{if(primeira){primeira=false;if(b.subarray(0,5).toString()!=='PGDMP')throw Error('CHECKPOINT_OPERACAO_DUMP_INVALIDO');}},nomeBanco+'.backup' as 'operacao.backup'|'entrada.backup');}finally{indiceBytes.fill(0);}
 }
 const cifra=criarCifraBackup(entrada.segredoTrabalho),base=entrada.referenciaInicialR2;
 let custodia:Buffer|undefined;
 try{
  if(plano.id===base.id)throw Error('CHECKPOINT_OPERACAO_ID_RECUSADO');
  custodia=await criarRepo({...entrada.backupExterno,prefixo:'donatella-v2'}).ler(`custodia/${base.id}.portatil.enc`,2*1024*1024)??undefined;
  if(!custodia||sha(custodia)!==base.custodiaSha256)throw Error('CHECKPOINT_OPERACAO_CUSTODIA_DIVERGENTE');
  const config={...entrada.backupExterno,prefixo},repo=criarRepo(config);
  const pacote=criarPreservadorPacote({config,cifra,id:plano.id,estagio,repositorio:repo});
  const arquivos:ManifestoBackup['arquivos']=[];
  for(const f of plano.fontes){
   const b=await fonteBytes(f);
   try{arquivos.push(await pacote.adicionar(f.destino,b));}finally{b.fill(0);}
  }
  const info=Buffer.from(JSON.stringify({versao:2,id:plano.id,criadoEm:plano.criadoEm,banco:plano.banco,bancoEntrada:plano.bancoEntrada,proveniencia:plano.proveniencia,
    indiceBanco:'operacao/banco/operacao.indice.json',indiceEntrada:'operacao/banco/entrada.indice.json',coerenciaEntreBancos:'snapshots_sequenciais_reconciliar_por_chave',custodiaOriginal:base.id,historicoMigracaoPreservadoSeparadamente:true,
    restauracaoPostgreSQLExecutada:false,operacaoAtivada:false}));
  try{arquivos.push(await pacote.adicionar('operacao.json',info));}finally{info.fill(0);}
  const referencia=await pacote.concluir({versao:1,id:plano.id,criadoEm:plano.criadoEm,proveniencia:plano.proveniencia,arquivos:arquivos.sort((a,b)=>a.destino.localeCompare(b.destino))});
  await repo.preservar(`custodia/${plano.id}.portatil.enc`,custodia);
  const descoberta={versao:2,id:plano.id,banco:plano.banco,bancoEntrada:plano.bancoEntrada,criadoEm:plano.criadoEm,proveniencia:plano.proveniencia,referencia,custodiaOriginal:base.id,custodiaSha256:base.custodiaSha256};
  await repo.preservar(`referencias/${plano.id}.json`,Buffer.from(JSON.stringify(descoberta)));
  return {...descoberta,concluidoEm:new Date().toISOString(),restauracaoRealComprovada:false};
 }finally{custodia?.fill(0);cifra.fechar();}
}
/** Extração usa SOMENTE este ponto externo e custódia cifrada; nunca banco/cache/Cloud.
 * Destinatário escreve apenas num estágio privado novo, sem executar SQL ou envios.
 */
export async function extrairCheckpointOperacaoR2(entrada:EntradaVerificacaoR2,id:string,digest:string,receber:(nome:string,b:Buffer)=>Promise<void>,criarRepo:(c:ConfiguracaoS3)=>Repositorio=criarRepositorioS3){
 if(!uuid.test(id)||!/^[a-f0-9]{64}$/.test(digest))throw Error('CHECKPOINT_OPERACAO_REFERENCIA_INVALIDA');
 const repo=criarRepo({...entrada.backupExterno,prefixo});
 const bytes=await repo.ler(`referencias/${id}.json`,16384);if(!bytes)throw Error('CHECKPOINT_OPERACAO_REFERENCIA_AUSENTE');
 const r=JSON.parse(bytes.toString());
 if(![1,2].includes(r.versao)||r.id!==id||r.referencia?.sha256!==digest||r.custodiaOriginal!==entrada.referenciaInicialR2.id||r.custodiaSha256!==entrada.referenciaInicialR2.custodiaSha256
   ||(r.versao===2&&!((r.bancoEntrada==='donatella_entrada'&&r.banco==='donatella_operacao')||(r.bancoEntrada==='donatella_ensaio_entrada_backup'&&r.banco==='donatella_ensaio_backup')))||!((r.banco==='donatella_operacao'&&r.proveniencia==='copia_real_preservada')||(r.banco==='donatella_ensaio_backup'&&r.proveniencia==='ensaio_ficticio')))throw Error('CHECKPOINT_OPERACAO_REFERENCIA_DIVERGENTE');
 const cofre=await repo.ler(`custodia/${id}.portatil.enc`,2*1024*1024);if(!cofre||sha(cofre)!==r.custodiaSha256)throw Error('CHECKPOINT_OPERACAO_CUSTODIA_DIVERGENTE');cofre.fill(0);
 const cifra=criarCifraBackup(entrada.segredoTrabalho);let infoConferida=false;const destinos=new Set<string>();
 try{
  const prova=await recuperarPacoteR2({id,sha256:digest,cifra,repositorio:repo,concorrencia:8,receber:async(nome,b)=>{
   destinos.add(nome);
   if(nome==='operacao.json'){
    const i=JSON.parse(b.toString());if((r.versao===2&&(i.versao!==2||i.bancoEntrada!==r.bancoEntrada||i.indiceEntrada!=='operacao/banco/entrada.indice.json'))||i.id!==id||i.banco!==r.banco||i.proveniencia!==r.proveniencia||i.custodiaOriginal!==r.custodiaOriginal||i.indiceBanco!=='operacao/banco/operacao.indice.json')throw Error('CHECKPOINT_OPERACAO_METADADO_DIVERGENTE');infoConferida=true;
   }else if(!/^operacao\/(banco|configuracao|release|midia)\//.test(nome))throw Error('CHECKPOINT_OPERACAO_DESTINO_RECUSADO');
   await receber(nome,b);
  }});
  if(!infoConferida||prova.proveniencia!==r.proveniencia||(r.versao===2&&(!destinos.has('operacao/banco/entrada.indice.json')||!destinos.has('operacao/banco/operacao.indice.json')||!destinos.has('operacao/configuracao/cobertura.json')||![...destinos].some(n=>n.startsWith('operacao/release/')))))throw Error('CHECKPOINT_OPERACAO_METADADO_DIVERGENTE');
  return {...prova,banco:r.banco,bancoEntrada:r.bancoEntrada??null,coberturaEntrada:r.versao===2,restauracaoRealComprovada:false,cacheLocalUsado:false};
 }finally{cifra.fechar();}
}
