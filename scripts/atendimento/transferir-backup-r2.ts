import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {lstat,mkdir,open,readFile,readdir,rename,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {recuperarConfiguracao,selarConfiguracao} from './cofre-portatil.mjs';
import {analisarConfiguracaoR2} from './configuracao-r2.mjs';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';
import {criarCifraBackup,criarPreservadorPacote,recuperarPacoteR2,type ManifestoBackup} from './backup-r2';
import {testarPermissoesR2} from './testar-r2';

const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Fonte={origem:string;destino:string;bytes:number;sha256:string};
type Plano={versao:1;id:string;criadoEm:string;fontes:Fonte[]};
type Entrada={acao:'transferir'|'recuperar'|'testar'|'testar-protecao';raiz:string;chave:string;configuracaoR2:string;id?:string;destino?:string};

async function privado(pasta:string){
 if(!isAbsolute(pasta)||resolve(pasta)!==pasta)throw Error('R2_PASTA_PRIVADA_INVALIDA');
 const real=await realpath(pasta);if(process.platform==='win32'?real.toLowerCase()!==pasta.toLowerCase():real!==pasta)throw Error('R2_PASTA_PRIVADA_INVALIDA');
 for(let atual=pasta;;atual=dirname(atual)){
  const info=await lstat(atual);if(!info.isDirectory()||info.isSymbolicLink())throw Error('R2_PASTA_PRIVADA_INVALIDA');
  try{await lstat(join(atual,'.git'));throw Error('R2_PASTA_EM_GIT');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(dirname(atual)===atual)break;
 }
}
async function lerPrivado(arquivo:string,limite=64*1024*1024){
 await privado(dirname(arquivo));
 const info=await lstat(arquivo);if(!info.isFile()||info.isSymbolicLink()||info.size>limite)throw Error('R2_FONTE_INVALIDA');
 return readFile(arquivo);
}
async function gravar(arquivo:string,bytes:Buffer|string,exclusivo=true){
 await privado(dirname(arquivo));
 const f=await open(arquivo,exclusivo?'wx':'w',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 if(process.platform!=='win32'){const d=await open(dirname(arquivo),'r');try{await d.sync();}finally{await d.close();}}
}
async function lerConfig(arquivo:string,chave:Buffer){
 const bytes=recuperarConfiguracao((await lerPrivado(arquivo,2*1024*1024)).toString('utf8'),chave);
 try{return JSON.parse(bytes.toString('utf8'));}finally{bytes.fill(0);}
}
function configS3(c:Record<string,string>):ConfiguracaoS3{
 return analisarConfiguracaoR2(`ACCOUNT_ID=${c.accountId}\nENDPOINT=${c.endpoint}\nBUCKET=${c.bucket}\nREGION=${c.regiao}\nACCESS_KEY_ID=${c.accessKey}\nSECRET_ACCESS_KEY=${c.secretKey}`);
}
async function fontesPreservadas(raiz:string,r2:string){
 const nomes:string[]=[];
 for(const grupo of ['arquivos','banco','cargas','midia']){
  async function visitar(pasta:string){
   await privado(pasta);
   for(const nome of (await readdir(pasta)).sort()){
    const caminho=join(pasta,nome),info=await lstat(caminho);
    if(info.isSymbolicLink())throw Error('R2_FONTE_INVALIDA');
    if(info.isDirectory())await visitar(caminho);
    else if(info.isFile()){
     const rel=relative(raiz,caminho).replaceAll('\\','/');
     if(grupo==='banco'&&nome==='export-anexo.backup')continue; // O mesmo export nativo ja selecionado abaixo.
     if(!/^[a-zA-Z0-9._/-]+$/.test(rel)||info.size>64*1024*1024)throw Error('R2_FONTE_INVALIDA');
     nomes.push(rel);
    }else throw Error('R2_FONTE_INVALIDA');
   }
  }
  await visitar(join(raiz,grupo));
 }
 const cofre=join(raiz,'cofre'),disponiveis=(await readdir(cofre)).sort();
 for(const fixo of ['config.portatil.enc','servicos-homologacao.portatil.enc']){if(!disponiveis.includes(fixo))throw Error('R2_CUSTODIA_AUSENTE');nomes.push('cofre/'+fixo);}
 for(const regex of [/^configuracoes-origem-.*\.portatil\.enc$/,/^meta-.*\.portatil\.enc$/]){
  const nome=disponiveis.filter(n=>regex.test(n)).at(-1);if(!nome)throw Error('R2_CUSTODIA_AUSENTE');nomes.push('cofre/'+nome);
 }
 if(dirname(r2)!==cofre||!/^r2-.*\.portatil\.enc$/.test(relative(cofre,r2)))throw Error('R2_CONFIGURACAO_INVALIDA');
 nomes.push('cofre/'+relative(cofre,r2));
 if(!nomes.includes('banco/sdrgrazing_261007.backup')||!nomes.includes('midia/manifesto-atual.jsonl')||!nomes.some(n=>n.startsWith('cargas/')&&n.endsWith('.json.enc')))throw Error('R2_CADEIA_INICIAL_INCOMPLETA');
 const destinos=new Set<string>(),fontes:Fonte[]=[];
 for(const origem of nomes){const destino=origem;if(destinos.has(destino.toLowerCase()))throw Error('R2_DESTINO_DUPLICADO');destinos.add(destino.toLowerCase());const bytes=await lerPrivado(join(raiz,origem));try{fontes.push({origem,destino,bytes:bytes.length,sha256:sha(bytes)});}finally{bytes.fill(0);}}
 return fontes;
}
function validarPlano(plano:Plano){
 if(plano.versao!==1||!uuid.test(plano.id)||!Number.isFinite(Date.parse(plano.criadoEm))||!Array.isArray(plano.fontes)||!plano.fontes.length||plano.fontes.length>10000)throw Error('R2_PLANO_INVALIDO');
 const nomes=new Set<string>();
 for(const f of plano.fontes){if(!f||typeof f.origem!=='string'||typeof f.destino!=='string'||!/^([a-zA-Z0-9_-]+\/)+[a-zA-Z0-9_.-]+$/.test(f.origem)||f.origem.split('/').some(p=>p==='..'||p==='.')||f.destino!==f.origem||nomes.has(f.destino.toLowerCase())||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>64*1024*1024)throw Error('R2_PLANO_INVALIDO');nomes.add(f.destino.toLowerCase());}
}

/** Recebe segredos apenas por stdin. Nenhum caminho privado ou erro de provedor e
 * impresso. A transferencia nao consulta Cloud e nao cria nova copia da origem.
 */
export async function executarBackupR2(entrada:Entrada,dependencias:{repositorio?:(config:ConfiguracaoS3)=>ReturnType<typeof criarRepositorioS3>}={}){
 const chave=Buffer.from(entrada.chave??'','base64');if(chave.length!==32)throw Error('R2_CHAVE_INVALIDA');
 let cifra:ReturnType<typeof criarCifraBackup>|undefined;
 try{
  await privado(entrada.raiz);
  const criarRepo=dependencias.repositorio??criarRepositorioS3;
  const c=await lerConfig(entrada.configuracaoR2,chave),config=configS3(c),repoCustodia=criarRepo(config),repo=criarRepo({...config,prefixo:config.prefixo+'/inicial'});
  if(entrada.acao==='testar'||entrada.acao==='testar-protecao')return testarPermissoesR2(config,entrada.acao==='testar-protecao');
  if(entrada.acao==='recuperar'){
   if(!entrada.id||!uuid.test(entrada.id)||!entrada.destino)throw Error('R2_REFERENCIA_INVALIDA');
   await privado(entrada.destino);
   if((await readdir(entrada.destino)).length!==0)throw Error('R2_RECUPERACAO_EXIGE_DIRETORIO_VAZIO');
   const externo=await repoCustodia.ler(`custodia/${entrada.id}.portatil.enc`,2*1024*1024);if(!externo)throw Error('R2_CUSTODIA_AUSENTE');
   const aberto=recuperarConfiguracao(externo.toString('utf8'),chave);let custodia;
   try{custodia=JSON.parse(aberto.toString('utf8'));}finally{aberto.fill(0);}
   if(custodia.versao!==1||custodia.id!==entrada.id||typeof custodia.segredoTrabalho!=='string'||typeof custodia.referencia?.sha256!=='string')throw Error('R2_CUSTODIA_INVALIDA');
   cifra=criarCifraBackup(custodia.segredoTrabalho);
   let arquivos=0;
   const resultado=await recuperarPacoteR2({id:entrada.id,sha256:custodia.referencia.sha256,cifra,repositorio:repo,receber:async(destino,bytes)=>{
    const caminho=resolve(entrada.destino!,destino);if(!caminho.startsWith(entrada.destino!+ (process.platform==='win32'?'\\':'/')))throw Error('R2_DESTINO_INVALIDO');
    await mkdir(dirname(caminho),{recursive:true,mode:0o700});await gravar(caminho,bytes);arquivos++;
    if(arquivos%50===0)process.stdout.write(JSON.stringify({etapa:'recuperacao_r2',arquivos})+'\n');
   }});
   // Confere os cofres recuperados do R2 com a chave externa, sem DPAPI.
   // Nenhum valor/relacao de campos e publicado no comprovante agregado.
   let configuracoesPortateisRecuperadas=0;
   for(const nome of (await readdir(join(entrada.destino,'cofre'))).filter(n=>n.endsWith('.portatil.enc'))){
    const recuperada=await lerConfig(join(entrada.destino,'cofre',nome),chave);
    if(!recuperada||typeof recuperada!=='object'||Array.isArray(recuperada))throw Error('R2_CUSTODIA_INVALIDA');
    if(nome==='config.portatil.enc'&&recuperada.ATENDIMENTO_CARGA_SECRET!==custodia.segredoTrabalho)throw Error('R2_CUSTODIA_DIVERGENTE');
    configuracoesPortateisRecuperadas++;
   }
   if(configuracoesPortateisRecuperadas!==5)throw Error('R2_CUSTODIA_INCOMPLETA');
   const prova={...resultado,id:entrada.id,origemExclusiva:'R2',cacheLocalUsado:false,configuracoesPortateisRecuperadas,concluidoEm:new Date().toISOString(),chaveMestraNaVPS:false};
   await gravar(join(entrada.destino,'prova-r2.json'),JSON.stringify(prova));return prova;
  }
  if(entrada.acao!=='transferir')throw Error('R2_ACAO_INVALIDA');
  const cfg=await lerConfig(join(entrada.raiz,'cofre/config.portatil.enc'),chave),segredo=cfg.ATENDIMENTO_CARGA_SECRET;
  cifra=criarCifraBackup(segredo);
  const estagio=join(entrada.raiz,'r2-estado');await mkdir(estagio,{recursive:true,mode:0o700});await privado(estagio);
  // V2 preserva a caixa dos nomes. O plano anterior interrompido fica guardado.
  const checkpoint=join(estagio,'base-inicial-v2.portatil.enc');let plano:Plano;
  try{plano=await lerConfig(checkpoint,chave);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;plano={versao:1,id:randomUUID(),criadoEm:new Date().toISOString(),fontes:await fontesPreservadas(entrada.raiz,entrada.configuracaoR2)};await gravar(checkpoint,selarConfiguracao(Buffer.from(JSON.stringify(plano)),chave));}
  validarPlano(plano);
  const pacote=criarPreservadorPacote({config:{...config,prefixo:config.prefixo+'/inicial'},cifra,estagio,id:plano.id,repositorio:repo});
  const manifesto:ManifestoBackup={versao:1,id:plano.id,criadoEm:plano.criadoEm,proveniencia:'copia_real_preservada',arquivos:[]};
  let ultimoProgresso=0;
  // Tres arquivos independentes, no maximo 192 MiB de fontes simultaneas.
  // Espera todos os resultados; uma falha bloqueia manifesto/aceite do pacote.
  for(let inicio=0;inicio<plano.fontes.length;inicio+=3){
   const resultados=await Promise.allSettled(plano.fontes.slice(inicio,inicio+3).map(async f=>{
    const bytes=await lerPrivado(join(entrada.raiz,f.origem));
    try{if(bytes.length!==f.bytes||sha(bytes)!==f.sha256)throw Error('R2_FONTE_ALTERADA');return await pacote.adicionar(f.destino,bytes);}finally{bytes.fill(0);}
   }));
   for(const r of resultados){if(r.status==='rejected')throw r.reason;manifesto.arquivos.push(r.value);}
   if(manifesto.arquivos.length-ultimoProgresso>=25||manifesto.arquivos.length===plano.fontes.length){ultimoProgresso=manifesto.arquivos.length;process.stdout.write(JSON.stringify({etapa:'transferencia_r2',arquivos:ultimoProgresso,total:plano.fontes.length})+'\n');}
  }
  const referencia=await pacote.concluir(manifesto),custodiaPath=join(estagio,'custodia-'+plano.id+'.portatil.enc');
  const conteudo=Buffer.from(JSON.stringify({versao:1,id:plano.id,segredoTrabalho:segredo,referencia,criadoEm:plano.criadoEm}));
  try{await gravar(custodiaPath,selarConfiguracao(conteudo,chave));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  const custodia=await lerPrivado(custodiaPath,2*1024*1024),conferida=recuperarConfiguracao(custodia.toString('utf8'),chave);
  try{if(conteudo.length!==conferida.length||!timingSafeEqual(conteudo,conferida))throw Error('R2_CUSTODIA_DIVERGENTE');}finally{conteudo.fill(0);conferida.fill(0);}
  await repoCustodia.preservar(`custodia/${plano.id}.portatil.enc`,custodia);
  const prova={...referencia,custodia:`custodia/${plano.id}.portatil.enc`,verificadoEm:new Date().toISOString(),recuperacaoRealComprovada:false};
  const temporario=join(estagio,'prova-'+randomUUID()+'.parcial');await gravar(temporario,JSON.stringify(prova));await rename(temporario,join(estagio,'transferencia-inicial.json'));return prova;
 }finally{cifra?.fechar();chave.fill(0);}
}

async function cli(){
 const partes:Buffer[]=[];let n=0;
 try{for await(const p of process.stdin){n+=p.length;if(n>16384)throw Error('R2_ENTRADA_INVALIDA');partes.push(p);}const entrada=JSON.parse(Buffer.concat(partes).toString('utf8'));const resultado=await executarBackupR2(entrada);process.stdout.write(JSON.stringify(resultado)+'\n');}
 finally{for(const p of partes)p.fill(0);}
}
if(process.argv[1]?.endsWith('transferir-backup-r2.ts')||process.argv[1]?.endsWith('transferir-backup-r2.mjs'))cli().catch(e=>{const codigo=(e as Error).message;const http=(e as {http?:number}).http;if(Number.isInteger(http)&&http!>=100&&http!<=599)process.stdout.write(JSON.stringify({etapa:'sonda_r2_recusada',http})+'\n');process.stderr.write((/^(R2|BACKUP|COFRE)_[A-Z_]+$/.test(codigo)?codigo:'R2_EXECUCAO_RECUSADA')+'\n');process.exitCode=1;});
