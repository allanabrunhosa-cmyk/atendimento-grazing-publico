import {createHash} from 'node:crypto';
import {lstat,readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';
import {criarCifraBackup,criarPreservadorPacote,recuperarPacoteR2,type ManifestoBackup} from './backup-r2';
import type {EntradaVerificacaoR2} from './verificacao-r2';

const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
type Fonte={caminho:string;destino:string;bytes:number;sha256:string};
export type PlanoCheckpoint={versao:1;id:string;criadoEm:string;proveniencia:'copia_real_preservada'|'ensaio_ficticio';fontes:Fonte[]};
type Repositorio=ReturnType<typeof criarRepositorioS3>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Reserva medida: base externa ~720 MB. Crescimento exige nova estimativa antes
// de ampliar a rotina; preservar a ultima copia valida e tornar a falha visivel.
const capacidadePonto=1024*1024*1024;
export async function validarFonte(caminho:string){
 for(let p=dirname(caminho);;p=dirname(p)){
  const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('CHECKPOINT_FONTE_RECUSADA');
  try{await lstat(join(p,'.git'));throw Error('CHECKPOINT_FONTE_EM_GIT');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(dirname(p)===p)break;
 }
}

function validar(p:PlanoCheckpoint){
 if(p.versao!==1||!uuid.test(p.id)||!Number.isFinite(Date.parse(p.criadoEm))||!['copia_real_preservada','ensaio_ficticio'].includes(p.proveniencia)||!p.fontes.length||p.fontes.length>7000)throw Error('CHECKPOINT_PLANO_INVALIDO');
 const destinos=new Set<string>();
 for(const f of p.fontes){
  if(!f||resolve(f.caminho)!==f.caminho||!/^novos\/([a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(f.destino)||f.destino.split('/').some(n=>n==='.'||n==='..')||destinos.has(f.destino)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('CHECKPOINT_PLANO_INVALIDO');
  destinos.add(f.destino);
 }
 if(!destinos.has('novos/banco/preparacao.backup')&&!destinos.has('novos/banco/preparacao.indice.json'))throw Error('CHECKPOINT_BANCO_AUSENTE');
}

/** Reconstituicao com hash de cada parte e do dump inteiro; nao restaura SQL. */
export async function recuperarBancoParticionado(indiceBytes:Buffer,ler:(nome:string)=>Promise<Buffer>,receber:(b:Buffer)=>Promise<void>,arquivo:'preparacao.backup'|'operacao.backup'|'entrada.backup'='preparacao.backup'){
 if(indiceBytes.length>16384)throw Error('CHECKPOINT_INDICE_BANCO_INVALIDO');
 const i=JSON.parse(indiceBytes.toString());
 if(i.versao!==1||i.arquivo!==arquivo||!Number.isSafeInteger(i.bytes)||i.bytes<1||i.bytes>capacidadePonto||!/^[a-f0-9]{64}$/.test(i.sha256)||!Array.isArray(i.partes)||!i.partes.length||i.partes.length>64)throw Error('CHECKPOINT_INDICE_BANCO_INVALIDO');
 const inteiro=createHash('sha256');let total=0;
 for(let n=0;n<i.partes.length;n++){
  const p=i.partes[n];if(p.nome!==arquivo+'.part-'+String(n).padStart(5,'0')||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>32*1024*1024||!/^[a-f0-9]{64}$/.test(p.sha256))throw Error('CHECKPOINT_INDICE_BANCO_INVALIDO');
  const b=await ler(p.nome);try{if(b.length!==p.bytes||sha(b)!==p.sha256)throw Error('CHECKPOINT_PARTE_BANCO_DIVERGENTE');inteiro.update(b);total+=b.length;await receber(b);}finally{b.fill(0);}
 }
 const sha256=inteiro.digest('hex');if(total!==i.bytes||sha256!==i.sha256)throw Error('CHECKPOINT_BANCO_DIVERGENTE');
 return {bytes:total,sha256};
}

/** Reempacota a base externa INTEGRAL, com banco/configuracao/release atuais e
 * todos os conteudos incrementais congelados. Nao usa arquivos locais como
 * fallback da base R2. Novo ponto independente renova a cadeia protegida pelo
 * prazo finito ja aprovado, sem mudar regras nem apagar pontos anteriores.
 */
export async function criarCheckpointR2(entrada:EntradaVerificacaoR2,plano:PlanoCheckpoint,estagio:string,criarRepo:(c:ConfiguracaoS3)=>Repositorio=criarRepositorioS3){
 validar(plano);
 const indiceBanco=plano.fontes.find(f=>f.destino==='novos/banco/preparacao.indice.json');
 if(indiceBanco){
  await validarFonte(indiceBanco.caminho);
  await recuperarBancoParticionado(await readFile(indiceBanco.caminho),async nome=>{
   const f=plano.fontes.find(f=>f.destino==='novos/banco/'+nome);if(!f)throw Error('CHECKPOINT_PARTE_BANCO_AUSENTE');await validarFonte(f.caminho);return readFile(f.caminho);
  },async()=>undefined);
 }
 const cifra=criarCifraBackup(entrada.segredoTrabalho),base=entrada.referenciaInicialR2;
 try{
  const config={...entrada.backupExterno,prefixo:'donatella-v2/incrementais/checkpoints'},repositorio=criarRepo(config);
  if(plano.id===base.id)throw Error('CHECKPOINT_ID_RECUSADO');
  const custodia=await criarRepo({...entrada.backupExterno,prefixo:'donatella-v2'}).ler(`custodia/${base.id}.portatil.enc`,2*1024*1024);
  if(!custodia||sha(custodia)!==base.custodiaSha256)throw Error('CHECKPOINT_CUSTODIA_DIVERGENTE');
  const pacote=criarPreservadorPacote({config,cifra,id:plano.id,estagio,repositorio});
  const arquivos=new Map<string,ManifestoBackup['arquivos'][number]>();
  let bytesPlanejados=plano.fontes.reduce((total,f)=>total+f.bytes,0);
  if(bytesPlanejados>capacidadePonto)throw Error('CHECKPOINT_CAPACIDADE_REQUER_REVISAO');
  const recuperado=await recuperarPacoteR2({id:base.id,sha256:base.manifestoSha256,cifra,repositorio:criarRepo({...entrada.backupExterno,prefixo:'donatella-v2/inicial'}),concorrencia:3,receber:async(n,b)=>{bytesPlanejados+=b.length;if(bytesPlanejados>capacidadePonto)throw Error('CHECKPOINT_CAPACIDADE_REQUER_REVISAO');arquivos.set(n,await pacote.adicionar(n,b));}});
  if(recuperado.proveniencia!==plano.proveniencia)throw Error('CHECKPOINT_PROVENIENCIA_DIVERGENTE');
  for(let inicio=0;inicio<plano.fontes.length;inicio+=3){
   const resultados=await Promise.allSettled(plano.fontes.slice(inicio,inicio+3).map(async f=>{
    await validarFonte(f.caminho);
    const s=await lstat(f.caminho);if(!s.isFile()||s.isSymbolicLink()||s.size!==f.bytes)throw Error('CHECKPOINT_FONTE_ALTERADA');
    const b=await readFile(f.caminho);
    try{if(sha(b)!==f.sha256)throw Error('CHECKPOINT_FONTE_ALTERADA');return await pacote.adicionar(f.destino,b);}finally{b.fill(0);}
   }));
   for(const r of resultados){if(r.status==='rejected')throw r.reason;arquivos.set(r.value.destino,r.value);}
  }
  const info=Buffer.from(JSON.stringify({versao:1,id:plano.id,criadoEm:plano.criadoEm,banco:plano.fontes.some(f=>f.destino==='novos/banco/preparacao.indice.json')?'novos/banco/preparacao.indice.json':'novos/banco/preparacao.backup',custodiaOriginal:base.id,sincronizacaoCompletaComOrigem:false,rotinasOperacionaisAtivadas:false}));
  try{arquivos.set('checkpoint.json',await pacote.adicionar('checkpoint.json',info));}finally{info.fill(0);}
  const referencia=await pacote.concluir({versao:1,id:plano.id,criadoEm:plano.criadoEm,proveniencia:plano.proveniencia,arquivos:[...arquivos.values()].sort((a,b)=>a.destino.localeCompare(b.destino))});
  await repositorio.preservar(`custodia/${plano.id}.portatil.enc`,custodia);
  custodia.fill(0);
  // Indice de descoberta sem clientes/segredos. Publicado SOMENTE depois da
  // releitura externa de todas as partes, manifesto e custodia. A custodia
  // continua aberta apenas pela chave mestra externa, nunca recebida pela VPS.
  const indice={versao:1,id:plano.id,criadoEm:plano.criadoEm,referencia,custodiaOriginal:base.id,custodiaSha256:base.custodiaSha256};
  await repositorio.preservar(`referencias/${plano.id}.json`,Buffer.from(JSON.stringify(indice)));
  return {...indice,concluidoEm:new Date().toISOString(),baseExternaIntegralConferida:true,arquivosIncrementais:plano.fontes.filter(f=>f.destino.startsWith('novos/midia/')).length,restauracaoRealComprovada:false,proveniencia:plano.proveniencia};
 }finally{cifra.fechar();}
}

/** Extracao exclusivamente externa. A restauracao PostgreSQL e a abertura da
 * custodia externa sao provas separadas; extracao nao declara esses aceites.
 */
export async function extrairCheckpointR2(entrada:EntradaVerificacaoR2,id:string,sha256:string,receber:(nome:string,b:Buffer)=>Promise<void>,criarRepo:(c:ConfiguracaoS3)=>Repositorio=criarRepositorioS3){
 if(!uuid.test(id)||!/^[a-f0-9]{64}$/.test(sha256))throw Error('CHECKPOINT_REFERENCIA_INVALIDA');
 const repo=criarRepo({...entrada.backupExterno,prefixo:'donatella-v2/incrementais/checkpoints'});
 const indiceBytes=await repo.ler(`referencias/${id}.json`,16384);if(!indiceBytes)throw Error('CHECKPOINT_REFERENCIA_AUSENTE');
 const indice=JSON.parse(indiceBytes.toString());
 if(indice.versao!==1||indice.id!==id||indice.referencia?.sha256!==sha256||indice.custodiaOriginal!==entrada.referenciaInicialR2.id||indice.custodiaSha256!==entrada.referenciaInicialR2.custodiaSha256)throw Error('CHECKPOINT_REFERENCIA_DIVERGENTE');
 const cofre=await repo.ler(`custodia/${id}.portatil.enc`,2*1024*1024);if(!cofre||sha(cofre)!==indice.custodiaSha256)throw Error('CHECKPOINT_CUSTODIA_DIVERGENTE');
 cofre.fill(0);
 const cifra=criarCifraBackup(entrada.segredoTrabalho);
 try{return await recuperarPacoteR2({id,sha256,cifra,repositorio:repo,receber,concorrencia:3});}finally{cifra.fechar();}
}
