// Canal privado: chave de recuperação apenas em memória local; nunca vai ao destino.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { recuperarConfiguracao, selarConfiguracao } from './cofre-portatil.mjs';
import { lerCanalPrivado, conferirNumeroDoCanal, gravarArquivoPrivadoExclusivo } from './canal-privado-operacao.mjs';
const dados=[]; let tamanho=0;
for await(const p of process.stdin){tamanho+=p.length;if(tamanho>16384)throw Error('ENTRADA_INVALIDA');dados.push(p);}
let chave,origemBytes,metaBytes;
try{
 const e=JSON.parse(Buffer.concat(dados).toString());chave=Buffer.from(e.chave,'base64');
 origemBytes=recuperarConfiguracao(await readFile(e.origem,'utf8'),chave);
 metaBytes=recuperarConfiguracao(await readFile(e.meta,'utf8'),chave);
 const origem=JSON.parse(origemBytes),meta=JSON.parse(metaBytes);
 const canal=await lerCanalPrivado(e.canalPrivado,meta.app_id);
 const linhas=[...(origem.nina_settings??[]),...(origem.system_settings??[])];
 const valor=n=>{const a=[...new Set(linhas.map(x=>x[n]).filter(x=>typeof x==='string'&&x.trim()))];if(a.length>1)throw Error('CONFIGURACAO_AMBIGUA');return a[0]??null;};
 const anth=[...new Set(linhas.map(x=>x.ai_api_keys?.anthropic).filter(x=>typeof x==='string'&&x.trim()))];
 if(anth.length!==1)throw Error('ANTHROPIC_NAO_CONFIGURADO');
 // Credencial/voz legadas são preservadas; nunca autorizam síntese no destino.
 const config={versao:1,criadaEm:new Date().toISOString(),meta:{appId:canal.appId,wabaId:canal.wabaId,phoneId:canal.phoneId,appSecret:meta.app_secret,verifyToken:valor('whatsapp_verify_token'),accessToken:valor('whatsapp_access_token'),graphVersion:canal.graphVersion},ia:{apiKey:anth[0],model:valor('ai_model')??'claude-sonnet-4-5-20250929'},woocommerce:{url:valor('wc_site_url'),consumerKey:valor('wc_consumer_key'),consumerSecret:valor('wc_consumer_secret'),webhookSecret:valor('wc_webhook_secret'),webhookIds:[],automacoesHabilitadas:false},voz:{apiKey:valor('elevenlabs_api_key'),voiceId:valor('elevenlabs_voice_id'),model:valor('elevenlabs_model')??valor('elevenlabs_model_id')??'eleven_multilingual_v2',sinteseHabilitada:false}};
 const prova={instante:config.criadaEm,inferencias:0,envios:0,webhookAlterado:false,configuracaoMetaCompleta:!!(config.meta.appSecret&&config.meta.verifyToken&&config.meta.accessToken),wooCredenciaisPresentes:!!(config.woocommerce.url&&config.woocommerce.consumerKey&&config.woocommerce.consumerSecret),vozCredencialPresente:!!config.voz.apiKey,consultas:[]};
 async function consultar(nome,url,headers){try{const r=await fetch(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok){await r.body?.cancel();prova.consultas.push({nome,http:r.status,ok:false});return null;}const b=await r.text();if(Buffer.byteLength(b)>1048576)throw Error();const j=JSON.parse(b);prova.consultas.push({nome,http:r.status,ok:true});return j;}catch{prova.consultas.push({nome,ok:false,erro:'REDE_OU_RESPOSTA'});return null;}}
 if(prova.wooCredenciaisPresentes){const w=new URL(config.woocommerce.url);if(w.protocol!=='https:'||w.username||w.password||w.search||w.hash)throw Error('WOO_URL_RECUSADA');for(const entidade of ['products','orders']){const u=new URL(w.origin+w.pathname.replace(/\/$/,'')+'/wp-json/wc/v3/'+entidade);u.searchParams.set('per_page','1');u.searchParams.set('_fields','id');await consultar('woo_'+entidade,u,{Authorization:'Basic '+Buffer.from(config.woocommerce.consumerKey+':'+config.woocommerce.consumerSecret).toString('base64'),Accept:'application/json'});}}
 if(config.voz.apiKey){const s=await consultar('voz_assinatura','https://api.elevenlabs.io/v1/user/subscription',{'xi-api-key':config.voz.apiKey});prova.vozFranquia=s?{limite:s.character_limit,consumo:s.character_count}:null;const m=await consultar('voz_modelos','https://api.elevenlabs.io/v1/models',{'xi-api-key':config.voz.apiKey});prova.vozModelosDisponiveis=Array.isArray(m)?m.length:null;}
 const url=new URL('https://graph.facebook.com/'+config.meta.graphVersion+'/'+config.meta.wabaId+'/subscribed_apps');url.searchParams.set('appsecret_proof',createHmac('sha256',config.meta.appSecret).update(config.meta.accessToken).digest('hex'));
 const inscricoes=await consultar('meta_inscricoes_conta',url,{Authorization:'Bearer '+config.meta.accessToken});
 const urlNumeros=new URL('https://graph.facebook.com/'+config.meta.graphVersion+'/'+config.meta.wabaId+'/phone_numbers');urlNumeros.searchParams.set('fields','id');urlNumeros.searchParams.set('limit','100');urlNumeros.searchParams.set('appsecret_proof',url.searchParams.get('appsecret_proof'));
 conferirNumeroDoCanal(await consultar('meta_numeros_conta',urlNumeros,{Authorization:'Bearer '+config.meta.accessToken}),canal);prova.metaNumeroVinculado=true;
 const registro=inscricoes?.data?.find(x=>x.whatsapp_business_api_data?.id===config.meta.appId);
 config.meta.inscricaoAnterior=registro??null;prova.metaInscricaoLocalizada=!!registro;prova.metaInscricoesCompletas=!!inscricoes&&!inscricoes.paging?.next;
 for(const [nome,texto] of [['operacao-trabalho.json',JSON.stringify(config)],['operacao-trabalho.portatil.enc',selarConfiguracao(Buffer.from(JSON.stringify(config)),chave)],['operacao-conferencia-'+randomUUID()+'.json',JSON.stringify(prova)]]){await gravarArquivoPrivadoExclusivo(join(e.cofre,nome),texto);}
 console.log(JSON.stringify(prova));
}catch{console.error('PREPARACAO_PRIVADA_RECUSADA: conferir acesso/configuracao sem emitir valores.');process.exitCode=1;}
finally{chave?.fill(0);origemBytes?.fill(0);metaBytes?.fill(0);dados.forEach(p=>p.fill(0));}
