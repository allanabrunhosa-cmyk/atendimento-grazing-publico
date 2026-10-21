import {createHash} from 'node:crypto';
import {lstat,mkdir,open,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {criarCifraBackup} from './backup-r2';
import {criarCheckpointOperacaoR2,extrairCheckpointOperacaoR2,type PlanoCheckpointOperacao} from './checkpoint-operacao-r2';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';
import type {EntradaVerificacaoR2} from './verificacao-r2';

const prefixo='donatella-v2/incrementais/operacao',uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
type Repo=ReturnType<typeof criarRepositorioS3>;
type Resultado=Awaited<ReturnType<typeof criarCheckpointOperacaoR2>>;
type Objeto={chave:string;nome:string;bytes:number;sha256:string};
type Selo={versao:1;tipo:'spool-horario-cifrado-v1';id:string;objetos:Objeto[];resultado:Resultado};

async function pastaPrivada(p:string){
 if(resolve(p)!==p)throw Error('CHECKPOINT_OPERACAO_SPOOL_RECUSADO');
 await mkdir(p,{recursive:true,mode:0o700});const s=await lstat(p);
 if(!s.isDirectory()||s.isSymbolicLink())throw Error('CHECKPOINT_OPERACAO_SPOOL_RECUSADO');
}
async function exclusivo(p:string,b:Buffer){
 const f=await open(p,'wx',0o600);try{await f.writeFile(b);await f.sync();}finally{await f.close();}
 // A rotina de produção executa somente no Linux. Windows não oferece fsync
 // de diretório; aqui serve exclusivamente aos testes de protocolo fictício.
 if(process.platform!=='win32'){const d=await open(resolve(p,'..'),'r');try{await d.sync();}finally{await d.close();}}
}
async function bytesPrivados(p:string,max:number){
 const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw Error('CHECKPOINT_OPERACAO_SPOOL_RECUSADO');
 return readFile(p);
}
function raizPonto(estado:string,id:string){
 if(!uuid.test(id)||resolve(estado)!==estado)throw Error('CHECKPOINT_OPERACAO_SPOOL_RECUSADO');
 return join(estado,'spool-horario-v1',id);
}

/** Sela TODAS as fontes em spool durável cifrado antes de qualquer PUT do ponto.
 * O pacote/regras de recuperação são os existentes; o repositório nesta etapa
 * é somente um diário local cifrado. A custódia-base continua vindo do R2.
 */
export async function selarSpoolOperacao(entrada:EntradaVerificacaoR2,plano:PlanoCheckpointOperacao,estado:string,criarRepo:(c:ConfiguracaoS3)=>Repo=criarRepositorioS3,estagioTemporario?:string){
 const raiz=raizPonto(estado,plano.id);await pastaPrivada(estado);await pastaPrivada(join(estado,'spool-horario-v1'));
 // Nunca reaproveitar/alterar um snapshot parcialmente selado com fontes novas.
 await mkdir(raiz,{mode:0o700});await pastaPrivada(join(raiz,'objetos'));
 const objetos=new Map<string,Objeto>();let total=0;
 const repo:Repo={
  ler:async(chave,limite=48*1024*1024)=>{const o=objetos.get(chave);if(!o)return null;if(o.bytes>limite)throw Error('CHECKPOINT_OPERACAO_SPOOL_RECUSADO');const b=await bytesPrivados(join(raiz,'objetos',o.nome),limite);if(sha(b)!==o.sha256)throw Error('CHECKPOINT_OPERACAO_SPOOL_DIVERGENTE');return b;},
  preservar:async(chave,b)=>{
   if(!/^([a-z0-9_-]{1,128}\/)*[a-z0-9_-]{1,128}(\.[a-z0-9_-]{1,16}){0,3}$/.test(chave)||b.length>48*1024*1024||objetos.size>=10000)throw Error('CHECKPOINT_OPERACAO_SPOOL_RECUSADO');
   const antes=objetos.get(chave),digest=sha(b);if(antes){if(antes.sha256!==digest||antes.bytes!==b.length)throw Error('CHECKPOINT_OPERACAO_SPOOL_DIVERGENTE');return {bytes:b.length,sha256:digest};}
   total+=b.length;if(total>2*1024*1024*1024+16*1024*1024)throw Error('CHECKPOINT_OPERACAO_CAPACIDADE_REQUER_REVISAO');
   const nome=sha(Buffer.from(chave))+'.bin';await exclusivo(join(raiz,'objetos',nome),b);
   const lido=await bytesPrivados(join(raiz,'objetos',nome),b.length);try{if(!lido.equals(b))throw Error('CHECKPOINT_OPERACAO_SPOOL_DIVERGENTE');}finally{lido.fill(0);}
   objetos.set(chave,{chave,nome,bytes:b.length,sha256:digest});return {bytes:b.length,sha256:digest};
  },
 };
 // O timer fornece uma tmpfs exclusiva para o estágio intermediário do
 // particionador. A cópia única persistente são os objetos cifrados acima.
 // A variante sem argumento permanece apenas para consumidores já existentes.
 const estagio=estagioTemporario??raiz;await pastaPrivada(estagio);
 const r=await criarCheckpointOperacaoR2(entrada,plano,estagio,c=>c.prefixo===prefixo?repo:criarRepo(c));
 const selo:Selo={versao:1,tipo:'spool-horario-cifrado-v1',id:plano.id,objetos:[...objetos.values()],resultado:r};
 const cifra=criarCifraBackup(entrada.segredoTrabalho),aberto=Buffer.from(JSON.stringify(selo));
 try{await exclusivo(join(raiz,'selo.bin.enc'),cifra.cifrar(aberto,plano.id+'/spool-horario-v1'));}finally{aberto.fill(0);cifra.fechar();}
 return {id:plano.id,objetos:objetos.size,bytesCifrados:total,selado:true,publicadoR2:false};
}

async function lerSelo(entrada:EntradaVerificacaoR2,estado:string,id:string):Promise<Selo>{
 const raiz=raizPonto(estado,id);const s=await lstat(raiz);if(!s.isDirectory()||s.isSymbolicLink())throw Error('CHECKPOINT_OPERACAO_SPOOL_RECUSADO');
 const cifra=criarCifraBackup(entrada.segredoTrabalho);let b:Buffer|undefined;
 try{b=cifra.abrir(await bytesPrivados(join(raiz,'selo.bin.enc'),4*1024*1024),id+'/spool-horario-v1');const p=JSON.parse(b.toString()) as Selo;
  if(p.versao!==1||p.tipo!=='spool-horario-cifrado-v1'||p.id!==id||p.resultado.id!==id||!Array.isArray(p.objetos)||p.objetos.length<1||p.objetos.length>10000)throw Error('CHECKPOINT_OPERACAO_SPOOL_RECUSADO');
  const nomes=new Set<string>(),chaves=new Set<string>();let total=0;
  for(const o of p.objetos){if(!/^([a-z0-9_-]{1,128}\/)*[a-z0-9_-]{1,128}(\.[a-z0-9_-]{1,16}){0,3}$/.test(o.chave)||o.nome!==sha(Buffer.from(o.chave))+'.bin'||!/^[a-f0-9]{64}$/.test(o.sha256)||!Number.isSafeInteger(o.bytes)||o.bytes<0||o.bytes>48*1024*1024||nomes.has(o.nome)||chaves.has(o.chave))throw Error('CHECKPOINT_OPERACAO_SPOOL_RECUSADO');nomes.add(o.nome);chaves.add(o.chave);total+=o.bytes;}
  if(total>2*1024*1024*1024+16*1024*1024||!chaves.has('referencias/'+id+'.json')||!chaves.has('custodia/'+id+'.portatil.enc')||!chaves.has('manifestos/'+id+'.bin.enc'))throw Error('CHECKPOINT_OPERACAO_SPOOL_RECUSADO');
  return p;
 }finally{b?.fill(0);cifra.fechar();}
}

/** Retoma SOMENTE os bytes cifrados selados, sem consultar banco ou /entrada.
 * PUT exclusivo/releitura integral e extração R2 completa continuam obrigatórios.
 * Não é pg_restore, não declara recuperação PostgreSQL nem ativa operação.
 */
export async function publicarSpoolOperacao(entrada:EntradaVerificacaoR2,estado:string,id:string,criarRepo:(c:ConfiguracaoS3)=>Repo=criarRepositorioS3){
 const raiz=raizPonto(estado,id),selo=await lerSelo(entrada,estado,id),repo=criarRepo({...entrada.backupExterno,prefixo});
 // Antes do primeiro PUT, recusar qualquer ausência/alteração no spool selado.
 for(const o of selo.objetos){const b=await bytesPrivados(join(raiz,'objetos',o.nome),o.bytes);try{if(b.length!==o.bytes||sha(b)!==o.sha256)throw Error('CHECKPOINT_OPERACAO_SPOOL_DIVERGENTE');}finally{b.fill(0);}}
 const publicar=async(o:Objeto)=>{const b=await bytesPrivados(join(raiz,'objetos',o.nome),o.bytes);try{if(b.length!==o.bytes||sha(b)!==o.sha256)throw Error('CHECKPOINT_OPERACAO_SPOOL_DIVERGENTE');await repo.preservar(o.chave,b);}finally{b.fill(0);}};
 // Concorrência limitada somente após selagem e conferência de TODOS os bytes.
 // Aguarda cada lote, inclusive em falha. Referências nunca precedem as partes.
 const objetos=selo.objetos.filter(o=>!o.chave.startsWith('referencias/'));
 for(let inicio=0;inicio<objetos.length;inicio+=16){
  const resultados=await Promise.allSettled(objetos.slice(inicio,inicio+16).map(publicar));
  for(const r of resultados)if(r.status==='rejected')throw r.reason;
 }
 for(const o of selo.objetos.filter(o=>o.chave.startsWith('referencias/')))await publicar(o);
 await extrairCheckpointOperacaoR2(entrada,id,selo.resultado.referencia.sha256,async()=>undefined,criarRepo);
 return {...selo.resultado,concluidoEm:new Date().toISOString(),spoolHorarioPreservado:true,baseExternaIntegralConferida:true};
}
