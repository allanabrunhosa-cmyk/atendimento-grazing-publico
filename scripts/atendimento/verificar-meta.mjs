// Somente GET em endpoints oficiais fixos. Entrada privada por stdin; nunca ecoa URLs/credenciais.
import { createHmac, randomUUID } from 'node:crypto';
import { lstat, readFile, open } from 'node:fs/promises';
import { dirname, join, resolve, parse } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recuperarConfiguracao } from './cofre-portatil.mjs';

const APP='1468746651147688', WABA='693046076807360', PHONE='648633368337527';
const versao='v22.0'; // Versão já utilizada pela origem; versão efetiva retornada também é registrada.
async function jsonLimitado(resposta) {
  if(!resposta.body) throw new Error('RESPOSTA_INVALIDA');
  const leitor=resposta.body.getReader(); const partes=[]; let tamanho=0;
  try { for(;;){const p=await leitor.read();if(p.done)break;tamanho+=p.value.length;
    if(tamanho>1024*1024){await leitor.cancel();throw new Error('RESPOSTA_EXCESSIVA');} partes.push(p.value);}
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } finally {leitor.releaseLock();}
}
export async function conferirMeta({appSecret,token,verificarGrupos=false},fetchImpl=fetch) {
  if(!/^[A-Za-z0-9_-]{32,256}$/.test(appSecret)||typeof token!=='string'||token.length<20||token.length>4096) throw new Error('ENTRADA_INVALIDA');
  const prova={versao:1,instante:new Date().toISOString(),apiSolicitada:versao,appId:APP,wabaId:WABA,phoneId:PHONE,
    somenteLeitura:true,envios:0,webhookAlterado:false,consultas:[],appSecretValido:false,tokenValido:false};
  async function consultar(nome,path,credencial,parametros={}) {
    const url=new URL(`https://graph.facebook.com/${versao}/${path}`);
    for(const [k,v] of Object.entries(parametros))url.searchParams.set(k,v);
    url.searchParams.set('appsecret_proof',createHmac('sha256',appSecret).update(credencial).digest('hex'));
    try {
      const r=await fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${credencial}`,Accept:'application/json'},
        redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'});
      const corpo=await jsonLimitado(r);
      const estado={consulta:nome,http:r.status,ok:r.ok&&!corpo.error,apiEfetiva:r.headers.get('facebook-api-version'),
        codigoErro:Number.isInteger(corpo.error?.code)?corpo.error.code:null,
        subcodigoErro:Number.isInteger(corpo.error?.error_subcode)?corpo.error.error_subcode:null};
      prova.consultas.push(estado);
      return estado.ok?corpo:null;
    } catch {prova.consultas.push({consulta:nome,ok:false,falha:'REDE_OU_RESPOSTA_INVALIDA'});return null;}
  }
  const appToken=`${APP}|${appSecret}`;
  const app=await consultar('aplicativo',APP,appToken,{fields:'id'});
  prova.appSecretValido=app?.id===APP;
  if(!prova.appSecretValido)return prova;
  // input_token é o parâmetro do endpoint oficial. Só existe na URL em memória/HTTPS;
  // nunca é persistido em comprovante, argumentos, logs ou histórico do navegador.
  const debug=await consultar('validade_token','debug_token',appToken,{input_token:token});
  const d=debug?.data;
  prova.tokenValido=d?.is_valid===true&&String(d.app_id)===APP;
  prova.tokenAplicativoCorreto=String(d?.app_id)===APP;
  prova.escopos=Array.isArray(d?.scopes)?d.scopes.filter(s=>typeof s==='string'&&/^[a-z_]{1,100}$/.test(s)):[];
  prova.expiraEm=Number.isSafeInteger(d?.expires_at)?d.expires_at:null;
  prova.acessoDadosExpiraEm=Number.isSafeInteger(d?.data_access_expires_at)?d.data_access_expires_at:null;
  if(!prova.tokenValido)return prova;
  const subs=await consultar('assinaturas_waba',`${WABA}/subscribed_apps`,token);
  prova.aplicativoInscritoNaWaba=Array.isArray(subs?.data)&&subs.data.some(x=>x.whatsapp_business_api_data?.id===APP);
  prova.assinaturasWabaCompletas=!!subs&&!subs.paging?.next;
  const phone=await consultar('numero',PHONE,token,{fields:'id,quality_rating,code_verification_status'});
  prova.numeroCorreto=phone?.id===PHONE;
  prova.qualidadeNumero=typeof phone?.quality_rating==='string'?phone.quality_rating:null;
  prova.verificacaoNumero=typeof phone?.code_verification_status==='string'?phone.code_verification_status:null;
  const webhook=await consultar('configuracao_webhook',`${APP}/subscriptions`,appToken);
  prova.configuracaoWebhookConferida=Array.isArray(webhook?.data)&&!webhook.paging?.next;
  // Callback/versão/campos preservados somente no comprovante privado, sem verify token.
  prova.assinaturasAplicativo=Array.isArray(webhook?.data)?webhook.data.map(s=>({
    objeto:typeof s.object==='string'?s.object:null,callback:typeof s.callback_url==='string'?s.callback_url:null,
    ativo:s.active===true,campos:Array.isArray(s.fields)?s.fields.map(f=>({nome:f.name,versao:f.version})):[],
  })):[];
  if(verificarGrupos&&prova.numeroCorreto){
    // Campo no recurso oficial do MESMO número. Erro/ausência não significa OBA falsa.
    // Não consulta membros, cria grupos, altera subscriptions ou testa envios.
    const elegibilidade=await consultar('numero_oba',PHONE,token,{fields:'id,is_official_business_account'});
    prova.grupos={oba: elegibilidade?.id===PHONE&&typeof elegibilidade.is_official_business_account==='boolean'
      ?elegibilidade.is_official_business_account:null,
      limiteAtualPortfolio:null,elegibilidadeCompletaComprovada:false,envios:0,gruposCriados:0};
  }
  return prova;
}
async function arquivoPrivado(arquivo,raiz) {
  if(dirname(resolve(arquivo))!==raiz||(await lstat(arquivo)).isSymbolicLink())throw new Error('CAMINHO_INVALIDO');
  if((await lstat(arquivo)).size>2*1024*1024)throw new Error('ARQUIVO_EXCESSIVO');
  return readFile(arquivo,'utf8');
}
async function cli() {
  if(process.argv.length!==2)throw new Error();
  const partes=[];let n=0;
  for await(const p of process.stdin){n+=p.length;if(n>16384)throw new Error();partes.push(p);}
  let chave;let metaBytes;let origemBytes;
  try {
    const entrada=JSON.parse(Buffer.concat(partes).toString('utf8'));
    const raiz=resolve(entrada.cofre);let ancestral=raiz;
    for(;;){if((await lstat(ancestral)).isSymbolicLink())throw new Error();
      if(await lstat(join(ancestral,'.git')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw new Error();
      if(ancestral===parse(ancestral).root)break;ancestral=dirname(ancestral);}
    chave=Buffer.from(entrada.chave,'base64');if(chave.length!==32)throw new Error();
    metaBytes=recuperarConfiguracao(await arquivoPrivado(entrada.meta,raiz),chave);
    origemBytes=recuperarConfiguracao(await arquivoPrivado(entrada.origem,raiz),chave);
    const meta=JSON.parse(metaBytes.toString('utf8')),origem=JSON.parse(origemBytes.toString('utf8'));
    if(meta.app_id!==APP)throw new Error();
    const tokens=[...new Set([...(origem.nina_settings??[]),...(origem.system_settings??[])]
      .map(r=>r.whatsapp_access_token).filter(t=>typeof t==='string'&&t.trim()))];
    if(tokens.length!==1)throw new Error();
    const prova=await conferirMeta({appSecret:meta.app_secret,token:tokens[0],verificarGrupos:entrada.verificarGrupos===true});
    const destino=join(raiz,`meta-verificacao-${randomUUID()}.json`);
    const f=await open(destino,'wx',0o600);try{await f.writeFile(JSON.stringify(prova,null,2));await f.sync();}finally{await f.close();}
    console.log(JSON.stringify({comprovante:destino,appSecretValido:prova.appSecretValido,tokenValido:prova.tokenValido,
      aplicativoInscritoNaWaba:prova.aplicativoInscritoNaWaba??false,numeroCorreto:prova.numeroCorreto??false,
      configuracaoWebhookConferida:prova.configuracaoWebhookConferida??false,
      consultas:prova.consultas.map(({consulta,http,ok,codigoErro,subcodigoErro})=>({consulta,http,ok,codigoErro,subcodigoErro})),
      grupos:prova.grupos??null,envios:0,webhookAlterado:false}));
  } finally {chave?.fill(0);metaBytes?.fill(0);origemBytes?.fill(0);for(const p of partes)p.fill(0);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  cli().catch(()=>{console.error('VERIFICACAO_META_INTERROMPIDA: conferir privadamente acesso/arquivos. Nenhuma credencial registrada.');process.exitCode=1;});
