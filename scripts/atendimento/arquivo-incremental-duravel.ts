import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {lstat,mkdir,open,readFile,link,unlink} from 'node:fs/promises';
import type {DocumentoCarga} from '../../src/lib/atendimento/carga';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';
import {criarCifraBackup,criarPreservadorPacote,type ManifestoBackup} from './backup-r2';
import {lerVersaoFisica,versoesDaTransacao,type VersaoArquivo} from './arquivo-incremental';

type Cifra=ReturnType<typeof criarCifraBackup>;
type EntradaIndice={arquivo:string;sha256:string;bytes:number;metadata:{eTag:string}};
export type RegistroArquivoIncremental={versao:VersaoArquivo;arquivo:string;sha256:string;bytes:number;referencia:{id:string;chave:string;sha256:string}};
type Registro=RegistroArquivoIncremental;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const digest=/^[a-f0-9]{64}$/;
async function pastaPrivada(pasta:string){
 if(resolve(pasta)!==pasta)throw Error('ARQUIVO_DIRETORIO_INVALIDO');
 for(let p=pasta;;p=dirname(p)){
  try{const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('ARQUIVO_DIRETORIO_INVALIDO');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  try{await lstat(join(p,'.git'));throw Error('ARQUIVO_DIRETORIO_EM_GIT');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(dirname(p)===p)break;
 }
}
async function lerSeguro(arquivo:string,limite:number){
 await pastaPrivada(dirname(arquivo));const s=await lstat(arquivo);
 if(!s.isFile()||s.isSymbolicLink()||s.size>limite)throw Error('ARQUIVO_LOCAL_INVALIDO');
 return readFile(arquivo);
}
/** Publicacao exclusiva: fsync do arquivo, link atomico e fsync da pasta.
 * Nunca substitui uma versao existente; divergencia exige reconciliacao.
 */
async function publicar(arquivo:string,bytes:Buffer){
 await pastaPrivada(dirname(arquivo));await mkdir(dirname(arquivo),{recursive:true,mode:0o700});await pastaPrivada(dirname(arquivo));
 const parcial=join(dirname(arquivo),'.'+randomUUID()+'.parcial'),f=await open(parcial,'wx',0o600);
 try{
  await f.writeFile(bytes);await f.sync();await f.close();
  try{await link(parcial,arquivo);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  if(process.platform!=='win32'){const d=await open(dirname(arquivo),'r');try{await d.sync();}finally{await d.close();}}
 }finally{await f.close().catch(()=>undefined);await unlink(parcial);}
 const gravado=await lerSeguro(arquivo,bytes.length);try{if(!gravado.equals(bytes))throw Error('ARQUIVO_LOCAL_DIVERGENTE');}finally{gravado.fill(0);}
}
async function publicarCifrado(arquivo:string,conteudo:Buffer,contexto:string,cifra:Cifra){
 let cifrado:Buffer;
 try{cifrado=await lerSeguro(arquivo,8*1024*1024+64);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await publicar(arquivo,cifra.cifrar(conteudo,contexto));cifrado=await lerSeguro(arquivo,8*1024*1024+64);}
 const aberto=cifra.abrir(cifrado,contexto);try{if(!aberto.equals(conteudo))throw Error('ARQUIVO_DIARIO_DIVERGENTE');}finally{aberto.fill(0);}
}

/** Canal condicionado. Nomes/metadados ficam somente em diario privado cifrado
 * e manifestos cifrados no R2. A chave mestra de recuperacao nao e recebida.
 * Retomada exige reler o pacote externo antes de devolver sucesso ao ACK.
 */
export function criarCanalArquivos({config,cifra,estado,midiaInicial,indiceInicial,origem,credencial,repositorio=criarRepositorioS3(config),requisitar=fetch,registrar}:{config:ConfiguracaoS3;cifra:Cifra;estado:string;midiaInicial:string;indiceInicial:string;origem:string;credencial:string;repositorio?:ReturnType<typeof criarRepositorioS3>;requisitar?:typeof fetch;registrar?:(r:RegistroArquivoIncremental)=>Promise<void>}){
 let indice:Record<string,EntradaIndice[]>|undefined;
 const diario=join(estado,'versoes'),intencoes=join(estado,'intencoes'),cache=join(estado,'conteudos'),planos=join(estado,'planos');
 async function conteudo(arquivo:string,bytes:number,hash:string,pasta:string){
  if(!digest.test(hash)||arquivo!==hash+'.bin')throw Error('ARQUIVO_INDICE_INVALIDO');
  const b=await lerSeguro(join(pasta,arquivo),64*1024*1024);
  if(b.length!==bytes||sha(b)!==hash){b.fill(0);throw Error('ARQUIVO_PRESERVADO_DIVERGENTE');}
  return {bytes:b,sha256:hash};
 }
 async function buscar(v:VersaoArquivo){
  for(const pasta of [diario,intencoes])try{
   const b=cifra.abrir(await lerSeguro(join(pasta,v.identidade+'.bin.enc'),64*1024),'versoes/'+v.identidade);let r:Registro;try{r=JSON.parse(b.toString());}finally{b.fill(0);}
   if(JSON.stringify(r.versao)!==JSON.stringify(v)||r.bytes!==v.bytes)throw Error('ARQUIVO_DIARIO_DIVERGENTE');
   return conteudo(r.arquivo,r.bytes,r.sha256,cache);
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  indice??=JSON.parse((await lerSeguro(indiceInicial,16*1024*1024)).toString());
  const r=(indice![v.bucket+'/'+v.name]??[]).filter(r=>r.metadata.eTag===v.etag&&r.bytes===v.bytes);
  if(!r.length)return null;
  if(r.some(x=>x.sha256!==r[0].sha256))throw Error('ARQUIVO_INDICE_DIVERGENTE');
  return conteudo(r[0].arquivo,r[0].bytes,r[0].sha256,midiaInicial);
 }
 async function preservar(documento:DocumentoCarga){
  const versoes=versoesDaTransacao(documento);if(!versoes.length)return {versoesPreservadas:0,bytesPreservados:0};
  await pastaPrivada(estado);await mkdir(planos,{recursive:true,mode:0o700});
  const contexto='planos/'+documento.id,plano=join(planos,documento.id+'.bin.enc');let criadoEm:string;
  try{const b=cifra.abrir(await lerSeguro(plano,8*1024*1024+64),contexto);try{const p=JSON.parse(b.toString());if(JSON.stringify(p.versoes)!==JSON.stringify(versoes))throw Error('ARQUIVO_DIARIO_DIVERGENTE');criadoEm=p.criadoEm;if(typeof criadoEm!=='string'||!Number.isFinite(Date.parse(criadoEm)))throw Error('ARQUIVO_DIARIO_DIVERGENTE');}finally{b.fill(0);}}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;criadoEm=new Date().toISOString();await publicarCifrado(plano,Buffer.from(JSON.stringify({criadoEm,versoes})),contexto,cifra);}
  const pacote=criarPreservadorPacote({config,cifra,estagio:join(estado,'pacotes'),id:documento.id,repositorio});
  const manifesto:ManifestoBackup={versao:1,id:documento.id,criadoEm,proveniencia:'copia_real_preservada',arquivos:[]};
  const registros:Omit<Registro,'referencia'>[]=[];
  for(const v of versoes){
   const c=await buscar(v)??await lerVersaoFisica({origem,credencial,versao:v,requisitar});
   try{
    if(c.bytes.length!==v.bytes||sha(c.bytes)!==c.sha256)throw Error('ARQUIVO_PRESERVADO_DIVERGENTE');
    await publicar(join(cache,c.sha256+'.bin'),c.bytes);
    const intencao=Buffer.from(JSON.stringify({versao:v,arquivo:c.sha256+'.bin',sha256:c.sha256,bytes:c.bytes.length}));
    try{await publicarCifrado(join(intencoes,v.identidade+'.bin.enc'),intencao,'versoes/'+v.identidade,cifra);}finally{intencao.fill(0);}
    manifesto.arquivos.push(await pacote.adicionar('midia/'+v.identidade+'.bin',c.bytes));
    registros.push({versao:v,arquivo:c.sha256+'.bin',sha256:c.sha256,bytes:c.bytes.length});
   }finally{c.bytes.fill(0);}
  }
  const mapa=Buffer.from(JSON.stringify({versao:1,documento:documento.id,execucao:documento.execucao,registros}));
  try{manifesto.arquivos.push(await pacote.adicionar('mapa.json',mapa));}finally{mapa.fill(0);}
  const referencia=await pacote.concluir(manifesto);
  // Indice disponibilizado somente depois da releitura integral do R2.
  for(const r of registros){
   await registrar?.({...r,referencia});
   const arquivo=join(diario,r.versao.identidade+'.bin.enc'),ctx='versoes/'+r.versao.identidade;
   try{const b=cifra.abrir(await lerSeguro(arquivo,64*1024),ctx);try{const antigo:Registro=JSON.parse(b.toString());if(JSON.stringify(antigo.versao)!==JSON.stringify(r.versao)||antigo.sha256!==r.sha256||antigo.bytes!==r.bytes||antigo.arquivo!==r.arquivo||!antigo.referencia?.id)throw Error('ARQUIVO_DIARIO_DIVERGENTE');}finally{b.fill(0);}}
   catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const b=Buffer.from(JSON.stringify({...r,referencia}));try{await publicarCifrado(arquivo,b,ctx,cifra);}finally{b.fill(0);}}
  }
  return {versoesPreservadas:registros.length,bytesPreservados:registros.reduce((n,r)=>n+r.bytes,0),referencia};
 }
 return {preservar};
}
