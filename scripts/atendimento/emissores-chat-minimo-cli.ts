// Gera artefatos privados; nunca conecta à origem nem executa SQL ou chamadas Meta.
import {readFile,lstat,open,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,basename} from 'node:path';
import {hashEmissoresChat,prepararRetiradaEmissoresChat,prepararReposicaoEmissoresChat,produzirRetornoPreparadoChat,sqlPreflightEmissoresChat,type ContextoEmissoresChat} from './emissores-chat-minimo';
type Config={contexto:ContextoEmissoresChat;saida:string;preflight:string;observacaoRetirada:string;ensaio:string;conferenciaCredenciais:string;procedimento:string;portas:string;tokenNovoArquivo:string};
function exigir(v:unknown,c:string):asserts v{if(!v)throw Error('EMISSORES_CHAT_'+c);}
async function conferirCaminho(p:string){
 exigir(resolve(p)===p,'CAMINHO_ABSOLUTO_EXIGIDO');
 for(let a=dirname(p);;a=dirname(a)){
  const s=await lstat(a);exigir(s.isDirectory()&&!s.isSymbolicLink(),'DIRETORIO_RECUSADO');
  try{await lstat(join(a,'.git'));throw Error('EMISSORES_CHAT_GIT_RECUSADO');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(a===dirname(a))break;
 }
}
async function privado(p:string){
 await conferirCaminho(p);const s=await lstat(p);exigir(s.isFile()&&!s.isSymbolicLink()&&s.size<4*1024*1024&&(process.platform==='win32'||(s.mode&0o077)===0),'ARQUIVO_PRIVADO_RECUSADO');
 return readFile(p);
}
async function ler(p:string){return JSON.parse((await privado(p)).toString('utf8'));}
async function salvar(p:string,v:string|object){
 await conferirCaminho(p);const b=Buffer.from(typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');const f=await open(p,'wx',0o600);
 try{await f.writeFile(b);await f.sync();}finally{await f.close();}return{arquivo:basename(p),sha256:hashEmissoresChat(b)};
}
async function executar(){
 const modo=process.argv[2];
 if(modo==='--preflight-sql'&&process.argv.length===3){process.stdout.write(sqlPreflightEmissoresChat());return;}
 exigir(['--retirada','--retorno','--recibo'].includes(modo)&&process.argv.length===4,'USO_RECUSADO');
 const cfg=await ler(process.argv[3]) as Config;
 exigir(resolve(cfg.saida)===cfg.saida,'SAIDA_RECUSADA');await mkdir(cfg.saida,{recursive:true,mode:0o700});await conferirCaminho(join(cfg.saida,'artefato'));
 const p=await ler(cfg.preflight),c=cfg.contexto;
 if(modo==='--retirada'){
  const procedimento=prepararRetiradaEmissoresChat(c,p),{sql}=procedimento;
  const sqlReferencia=await salvar(join(cfg.saida,'retirar-emissores-chat.sql'),sql);
  await salvar(join(cfg.saida,'procedimento-emissores-chat.json'),{...procedimento,sqlReferencia});
 }else if(modo==='--retorno'){
  const o=await ler(cfg.observacaoRetirada),g=await ler(cfg.portas);
  // A conferência oficial é lida separadamente, não aceita um bool no formulário.
  g.credenciais=await ler(cfg.conferenciaCredenciais);
  const credencial=await ler(cfg.tokenNovoArquivo);
  const r=prepararReposicaoEmissoresChat(c,p,o,g,credencial.token);
  const sqlReferencia=await salvar(join(cfg.saida,'repor-emissores-chat-PRIVADO.sql'),r.sql);
  await salvar(join(cfg.saida,'reposicao-emissores-chat-preparada.json'),{tipo:'reposicao-emissores-chat-preparada-v1',...c,sqlReferencia,credencialRetornoFingerprint:r.credencialRetornoFingerprint,origemAlterada:false});
 }else{
  const caminhos={procedimento:cfg.procedimento,preflight:cfg.preflight,observacaoRetirada:cfg.observacaoRetirada,ensaio:cfg.ensaio,conferenciaCredenciais:cfg.conferenciaCredenciais};
  const refs={} as Record<keyof typeof caminhos,{arquivo:string;sha256:string}>;
  for(const [nome,arquivo] of Object.entries(caminhos)){
   exigir(dirname(arquivo)===cfg.saida,'REFERENCIA_FORA_PASTA');refs[nome as keyof typeof caminhos]={arquivo:basename(arquivo),sha256:hashEmissoresChat(await privado(arquivo))};
  }
  const proc=await ler(cfg.procedimento),gerado=prepararRetiradaEmissoresChat(c,p);
  exigir(proc.tipo===gerado.tipo&&proc.janelaId===c.janelaId&&proc.runtimeSha256===c.runtimeSha256&&proc.manifestoSha256===c.manifestoSha256&&proc.sqlSha256===gerado.sqlSha256&&proc.preflightSha256===gerado.preflightSha256,'PROCEDIMENTO_DIVERGENTE');
  exigir(/^[a-zA-Z0-9._-]{1,160}$/.test(proc.sqlReferencia?.arquivo)&&proc.sqlReferencia.sha256===gerado.sqlSha256&&hashEmissoresChat(await privado(join(cfg.saida,proc.sqlReferencia.arquivo)))===gerado.sqlSha256,'SQL_DIVERGENTE');
  const recibo=produzirRetornoPreparadoChat(c,p,await ler(cfg.observacaoRetirada),await ler(cfg.ensaio),await ler(cfg.conferenciaCredenciais),refs);
  await salvar(join(cfg.saida,'retorno-emissores-chat-preparado.json'),recibo);
 }
 process.stdout.write(JSON.stringify({artefatosPreparados:true,origemAlterada:false,chamadasExternas:0})+'\n');
}
executar().catch(e=>{const codigo=e instanceof Error&&/^EMISSORES_CHAT_[A-Z_]+$/.test(e.message)?e.message:'EMISSORES_CHAT_PREPARACAO_RECUSADA';process.stderr.write(JSON.stringify({artefatosPreparados:false,erro:codigo,origemAlterada:false})+'\n');process.exitCode=1;});
