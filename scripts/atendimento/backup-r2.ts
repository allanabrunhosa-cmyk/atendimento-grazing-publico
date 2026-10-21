import {createCipheriv,createDecipheriv,createHash,randomBytes,scryptSync} from 'node:crypto';
import {lstat,mkdir,open,readFile,link,unlink} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const LIMITE_PARTE=8*1024*1024,MAXIMO_ARQUIVO=64*1024*1024;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const cabecalho=Buffer.from('DONATELLA-R2-V1\0');
type Parte={chave:string;sha256:string;bytes:number;indice:number;hashAberto:string;bytesAbertos:number};
type Arquivo={destino:string;bytes:number;sha256:string;partes:Parte[]};
export type ManifestoBackup={versao:1;id:string;criadoEm:string;proveniencia:'copia_real_preservada'|'ensaio_ficticio';arquivos:Arquivo[]};
type Repositorio=ReturnType<typeof criarRepositorioS3>;

/** Segredo de trabalho, separado da chave mestra de custodia. Esta nunca e exigida
 * pela VPS. AAD vincula cada parte ao arquivo, pacote e indice esperado.
 */
export function criarCifraBackup(segredo:string){
 if(typeof segredo!=='string'||segredo.length<32||segredo.length>512)throw Error('BACKUP_CHAVE_TRABALHO_INVALIDA');
 const chave=scryptSync(segredo,'donatella-r2-arquivos:v1',32);
 const aad=(contexto:string)=>{if(!/^[a-z0-9/_-]{1,512}$/.test(contexto))throw Error('BACKUP_CONTEXTO_INVALIDO');return Buffer.from(contexto);};
 const cifrar=(bytes:Buffer,contexto:string)=>{
  if(bytes.length>LIMITE_PARTE)throw Error('BACKUP_PARTE_EXCEDE_LIMITE');
  const nonce=randomBytes(12),cifra=createCipheriv('aes-256-gcm',chave,nonce);cifra.setAAD(aad(contexto));
  const cifrado=Buffer.concat([cifra.update(bytes),cifra.final()]);
  return Buffer.concat([cabecalho,nonce,cifra.getAuthTag(),cifrado]);
 };
 const abrir=(bytes:Buffer,contexto:string)=>{
  if(bytes.length<cabecalho.length+28||bytes.length>cabecalho.length+28+LIMITE_PARTE||!bytes.subarray(0,cabecalho.length).equals(cabecalho))throw Error('BACKUP_CIFRA_RECUSADA');
  let parcial:Buffer|undefined;
  try{const n=cabecalho.length,cifra=createDecipheriv('aes-256-gcm',chave,bytes.subarray(n,n+12));cifra.setAAD(aad(contexto));cifra.setAuthTag(bytes.subarray(n+12,n+28));parcial=cifra.update(bytes.subarray(n+28));return Buffer.concat([parcial,cifra.final()]);}
  catch{throw Error('BACKUP_CIFRA_RECUSADA');}finally{parcial?.fill(0);}
 };
 return {cifrar,abrir,fechar:()=>chave.fill(0)};
}
type Cifra=ReturnType<typeof criarCifraBackup>;
const contexto=(id:string,destino:string,indice:number)=>`${id}/${hash(Buffer.from(destino))}/${indice}`;
const prefixoPartes=(destino:string)=>destino.startsWith('midia/')?'arquivos':'partes';
function conferirDestino(destino:string){
 if(typeof destino!=='string'||destino.length>256||!/^([a-zA-Z0-9_.-]{1,80}\/)*[a-zA-Z0-9_.-]{1,200}$/.test(destino)||destino.split('/').some(p=>p==='.'||p==='..'))throw Error('BACKUP_DESTINO_RECUSADO');
}
export function conferirManifestoBackup(valor:unknown):ManifestoBackup{
 if(!valor||typeof valor!=='object')throw Error('BACKUP_MANIFESTO_INVALIDO');
 const m=valor as ManifestoBackup;
 if(m.versao!==1||typeof m.id!=='string'||!uuid.test(m.id)||typeof m.criadoEm!=='string'||!Number.isFinite(Date.parse(m.criadoEm))||!['copia_real_preservada','ensaio_ficticio'].includes(m.proveniencia)||!Array.isArray(m.arquivos)||m.arquivos.length===0||m.arquivos.length>10000)throw Error('BACKUP_MANIFESTO_INVALIDO');
 const destinos=new Set<string>();
 for(const a of m.arquivos){
  if(!a||typeof a!=='object')throw Error('BACKUP_MANIFESTO_INVALIDO');
  conferirDestino(a.destino);
  if(destinos.has(a.destino)||!Number.isSafeInteger(a.bytes)||a.bytes<0||a.bytes>MAXIMO_ARQUIVO||!/^[a-f0-9]{64}$/.test(a.sha256)||!Array.isArray(a.partes)||a.partes.length!==Math.max(1,Math.ceil(a.bytes/LIMITE_PARTE)))throw Error('BACKUP_MANIFESTO_INVALIDO');
  destinos.add(a.destino);let bytes=0;
  a.partes.forEach((p,i)=>{
   if(!p||typeof p!=='object')throw Error('BACKUP_MANIFESTO_INVALIDO');
   if(p.indice!==i||p.chave!==`${prefixoPartes(a.destino)}/${m.id}/${p.sha256}.bin.enc`||!/^[a-f0-9]{64}$/.test(p.sha256)||!/^[a-f0-9]{64}$/.test(p.hashAberto)||!Number.isSafeInteger(p.bytesAbertos)||p.bytesAbertos<0||p.bytesAbertos>LIMITE_PARTE||p.bytes!==p.bytesAbertos+cabecalho.length+28||(i<a.partes.length-1&&p.bytesAbertos!==LIMITE_PARTE))throw Error('BACKUP_MANIFESTO_INVALIDO');
   bytes+=p.bytesAbertos;
  });
  if(bytes!==a.bytes)throw Error('BACKUP_MANIFESTO_INVALIDO');
 }
 return m;
}

async function gravarExclusivo(arquivo:string,bytes:Buffer){
 await mkdir(dirname(arquivo),{recursive:true,mode:0o700});
 const pasta=await lstat(dirname(arquivo));if(!pasta.isDirectory()||pasta.isSymbolicLink())throw Error('BACKUP_ESTAGIO_INVALIDO');
 const temporario=join(dirname(arquivo),`.${randomBytes(16).toString('hex')}.parcial`),f=await open(temporario,'wx',0o600);
 try{
  await f.writeFile(bytes);await f.sync();await f.close();
  try{await link(temporario,arquivo);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  if(process.platform!=='win32'){const dir=await open(dirname(arquivo),'r');try{await dir.sync();}finally{await dir.close();}}
 }finally{await f.close().catch(()=>undefined);await unlink(temporario);}
}
async function validarEstagio(raiz:string){
 for(let atual=raiz;;atual=dirname(atual)){
  try{const info=await lstat(atual);if(!info.isDirectory()||info.isSymbolicLink())throw Error('BACKUP_ESTAGIO_INVALIDO');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  try{await lstat(join(atual,'.git'));throw Error('BACKUP_ESTAGIO_EM_GIT');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(dirname(atual)===atual)break;
 }
}

/** Diario privado e cifrado das partes ANTES do PUT. Reinicio reutiliza exatamente
 * os mesmos bytes/nonce/chave R2, inclusive quando a resposta de envio foi perdida.
 * Somente o manifesto verificado e a marca de pacote recuperavel; nada e removido.
 */
export function criarPreservadorPacote({config,cifra,estagio,id,repositorio=criarRepositorioS3(config)}:{config:ConfiguracaoS3;cifra:Cifra;estagio:string;id:string;repositorio?:Repositorio}){
 if(!uuid.test(id)||resolve(estagio)!==estagio)throw Error('BACKUP_ESTAGIO_INVALIDO');
 const raiz=join(estagio,id);
 async function adicionar(destino:string,bytes:Buffer):Promise<Arquivo>{
  await validarEstagio(estagio);
  conferirDestino(destino);
  if(bytes.length>MAXIMO_ARQUIVO)throw Error('BACKUP_ARQUIVO_EXCEDE_LIMITE');
  const partes:Parte[]=[],nome=hash(Buffer.from(destino));
  for(let indice=0,inicio=0;indice<Math.max(1,Math.ceil(bytes.length/LIMITE_PARTE));indice++,inicio+=LIMITE_PARTE){
   const aberto=bytes.subarray(inicio,inicio+LIMITE_PARTE),ctx=contexto(id,destino,indice),local=join(raiz,`${nome}-${indice}.bin.enc`);
   try{const info=await lstat(local);if(!info.isFile()||info.isSymbolicLink()||info.size>LIMITE_PARTE+cabecalho.length+28)throw Error('BACKUP_ESTAGIO_INVALIDO');}
   catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await gravarExclusivo(local,cifra.cifrar(aberto,ctx));}
   const cifrado=await readFile(local),restaurado=cifra.abrir(cifrado,ctx);
   try{if(!restaurado.equals(aberto))throw Error('BACKUP_FONTE_ALTERADA');}finally{restaurado.fill(0);}
   const digest=hash(cifrado),chave=`${prefixoPartes(destino)}/${id}/${digest}.bin.enc`;
   await repositorio.preservar(chave,cifrado);
   partes.push({chave,sha256:digest,bytes:cifrado.length,indice,hashAberto:hash(aberto),bytesAbertos:aberto.length});
  }
  return {destino,bytes:bytes.length,sha256:hash(bytes),partes};
 }
 async function concluir(manifesto:ManifestoBackup){
  await validarEstagio(estagio);
  conferirManifestoBackup(manifesto);if(manifesto.id!==id)throw Error('BACKUP_MANIFESTO_INVALIDO');
  // Refaz a prova externa de cada parte; um diario local nao comprova R2.
  for(const a of manifesto.arquivos)for(const p of a.partes){const bytes=await repositorio.ler(p.chave,p.bytes);if(!bytes||bytes.length!==p.bytes||hash(bytes)!==p.sha256)throw Error('BACKUP_PARTE_AUSENTE_OU_DIVERGENTE');}
  const nome=join(raiz,'manifesto.bin.enc'),ctx=`${id}/manifesto`;
  const conteudo=Buffer.from(JSON.stringify(manifesto));if(conteudo.length>LIMITE_PARTE)throw Error('BACKUP_MANIFESTO_EXCEDE_LIMITE');
  await gravarExclusivo(nome,cifra.cifrar(conteudo,ctx));
  const bytes=await readFile(nome),aberto=cifra.abrir(bytes,ctx);try{if(!aberto.equals(conteudo))throw Error('BACKUP_MANIFESTO_DIVERGENTE');}finally{aberto.fill(0);}
  const chave=`manifestos/${id}.bin.enc`;await repositorio.preservar(chave,bytes);
  return {id,chave,sha256:hash(bytes),arquivos:manifesto.arquivos.length,bytesAbertos:manifesto.arquivos.reduce((n,a)=>n+a.bytes,0)};
 }
 return {adicionar,concluir};
}

/** Recuperacao so pelo repositorio externo e chave de trabalho recuperada da
 * custodia. Sem cache local, Cloud, banco HUB ou chamadas de atendimento.
 */
export async function recuperarPacoteR2({id,sha256,cifra,repositorio,receber,concorrencia=1}:{id:string;sha256:string;cifra:Cifra;repositorio:Repositorio;receber:(destino:string,bytes:Buffer)=>Promise<void>;concorrencia?:number}){
 if(!Number.isInteger(concorrencia)||concorrencia<1||concorrencia>8)throw Error('BACKUP_CONCORRENCIA_RECUSADA');
 if(!uuid.test(id)||!/^[a-f0-9]{64}$/.test(sha256))throw Error('BACKUP_REFERENCIA_INVALIDA');
 const externo=await repositorio.ler(`manifestos/${id}.bin.enc`,LIMITE_PARTE+cabecalho.length+28);
 if(!externo||hash(externo)!==sha256)throw Error('BACKUP_MANIFESTO_AUSENTE_OU_DIVERGENTE');
 const bytes=cifra.abrir(externo,`${id}/manifesto`);let manifesto:ManifestoBackup;
 try{manifesto=conferirManifestoBackup(JSON.parse(bytes.toString('utf8')));}finally{bytes.fill(0);}
 if(manifesto.id!==id)throw Error('BACKUP_MANIFESTO_INVALIDO');
 async function recuperar(a:Arquivo){
  const partes:Buffer[]=[];
  try{
   for(const p of a.partes){const cifrado=await repositorio.ler(p.chave,p.bytes);if(!cifrado||cifrado.length!==p.bytes||hash(cifrado)!==p.sha256)throw Error('BACKUP_PARTE_AUSENTE_OU_DIVERGENTE');const aberto=cifra.abrir(cifrado,contexto(id,a.destino,p.indice));partes.push(aberto);if(aberto.length!==p.bytesAbertos||hash(aberto)!==p.hashAberto)throw Error('BACKUP_PARTE_ABERTA_DIVERGENTE');}
   const conteudo=Buffer.concat(partes);try{if(conteudo.length!==a.bytes||hash(conteudo)!==a.sha256)throw Error('BACKUP_ARQUIVO_DIVERGENTE');await receber(a.destino,conteudo);}finally{conteudo.fill(0);}
  }finally{for(const p of partes)p.fill(0);}
 }
 for(let inicio=0;inicio<manifesto.arquivos.length;inicio+=concorrencia){
  const resultados=await Promise.allSettled(manifesto.arquivos.slice(inicio,inicio+concorrencia).map(recuperar));
  for(const r of resultados)if(r.status==='rejected')throw r.reason;
 }
 return {arquivos:manifesto.arquivos.length,bytes:manifesto.arquivos.reduce((n,a)=>n+a.bytes,0),proveniencia:manifesto.proveniencia};
}
