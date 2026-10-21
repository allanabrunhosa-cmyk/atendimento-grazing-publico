import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferirMeta } from './verificar-meta.mjs';
const app='1468746651147688',secret='s'.repeat(32),token='t'.repeat(40);
test('cinco GET oficiais, credenciais privadas e configuração sem token/identidade',async()=>{
  const urls=[];
  const respostas=[{id:app},{data:{is_valid:true,app_id:app,scopes:['whatsapp_business_messaging'],expires_at:0,user_id:'PRIVADO'}},
    {data:[{whatsapp_business_api_data:{id:app}}]},{id:'648633368337527',quality_rating:'GREEN'},
    {data:[{object:'whatsapp_business_account',callback_url:'https://origem.invalid/webhook',active:true,verify_token:'NAO_PERSISTIR',fields:[{name:'messages',version:'v22.0'}]}]}];
  const p=await conferirMeta({appSecret:secret,token},async(u,o)=>{
    urls.push(u);assert.equal(u.origin,'https://graph.facebook.com');assert.equal(o.method,'GET');assert.equal(o.redirect,'error');
    assert.ok(o.headers.Authorization.startsWith('Bearer '));return Response.json(respostas.shift());});
  assert.equal(urls.length,5);assert.equal(p.tokenValido,true);assert.equal(p.numeroCorreto,true);assert.equal(p.configuracaoWebhookConferida,true);
  const j=JSON.stringify(p);for(const proibido of [secret,token,'PRIVADO','NAO_PERSISTIR'])assert.ok(!j.includes(proibido));
});
test('segredo inválido não prossegue nem ecoa erro do provedor',async()=>{
  let calls=0;const p=await conferirMeta({appSecret:secret,token},async()=>{calls++;return Response.json({error:{code:190,message:secret+token}},{status:400});});
  assert.equal(calls,1);assert.equal(p.appSecretValido,false);assert.equal(p.consultas[0].codigoErro,190);assert.ok(!JSON.stringify(p).includes(secret));
});
test('token de outro aplicativo interrompe antes de WABA/número',async()=>{
  let n=0;const p=await conferirMeta({appSecret:secret,token},async()=>Response.json(n++===0?{id:app}:{data:{is_valid:true,app_id:'outro'}}));
  assert.equal(n,2);assert.equal(p.tokenValido,false);
});
test('erro de rede e resposta excessiva são registrados sem detalhes privados',async()=>{
  const p=await conferirMeta({appSecret:secret,token},async()=>{throw new Error(secret);});assert.equal(p.appSecretValido,false);assert.ok(!JSON.stringify(p).includes(secret));
  const q=await conferirMeta({appSecret:secret,token},async()=>new Response('x'.repeat(1024*1024+1)));assert.equal(q.appSecretValido,false);
});
test('OBA falsa só é comprovada pelo booleano do mesmo número; GET não faz operação',async()=>{
  const chamadas=[];
  const respostas=[{id:app},{data:{is_valid:true,app_id:app}}, {data:[]}, {id:'648633368337527'}, {data:[]}, {id:'648633368337527',is_official_business_account:false}];
  const p=await conferirMeta({appSecret:secret,token,verificarGrupos:true},async(u,o)=>{
    chamadas.push(u);assert.equal(o.method,'GET');return Response.json(respostas.shift());
  });
  assert.equal(chamadas.length,6);assert.equal(chamadas[5].searchParams.get('fields'),'id,is_official_business_account');
  assert.equal(p.grupos.oba,false);assert.equal(p.grupos.elegibilidadeCompletaComprovada,false);assert.equal(p.grupos.gruposCriados,0);
});
test('erro ou número divergente na OBA permanece desconhecido sem ecoar corpo privado',async()=>{
  for(const ultima of [{error:{code:100,message:secret}}, {id:'outro',is_official_business_account:true}, {id:'648633368337527'}]){
    const respostas=[{id:app},{data:{is_valid:true,app_id:app}}, {data:[]}, {id:'648633368337527'}, {data:[]}, ultima];
    const p=await conferirMeta({appSecret:secret,token,verificarGrupos:true},async()=>Response.json(respostas.shift()));
    assert.equal(p.grupos.oba,null);assert.ok(!JSON.stringify(p).includes(secret));
  }
});
