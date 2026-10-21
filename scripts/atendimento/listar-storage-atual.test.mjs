import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listarStorageAtual,mesmoInstanteStorage } from './listar-storage-atual.mjs';
const options={origem:'https://teste-ficticio.supabase.co',chavePublica:'publica-ficticia',bucket:'whatsapp-media'};
const objeto=id=>({id,name:`ficticio-${id}.txt`,updated_at:'2026-10-07T00:00:00Z'});
test('normaliza timezone/precisão da listagem sem inventar mudança em todos os arquivos',()=>{
  assert.equal(mesmoInstanteStorage('2026-10-07T00:00:00.123456+00:00','2026-10-07T00:00:00.123Z'),true);
  assert.equal(mesmoInstanteStorage('2026-10-07T00:00:00.123456+00:00','2026-10-07T00:00:00.124Z'),false);
  assert.throws(()=>mesmoInstanteStorage('invalido','2026-10-07T00:00:00Z'),/LISTAGEM_TIMESTAMP_INVALIDO/);
});
test('segue cursor sem hierarquia e preserva objetos de todas as páginas',async()=>{
  let calls=0;
  const result=await listarStorageAtual({...options,fetchImpl:async(url,init)=>{
    assert.equal(new URL(url).pathname,'/storage/v1/object/list-v2/whatsapp-media');
    const body=JSON.parse(init.body); assert.equal(body.with_delimiter,false);
    if(!calls++){assert.equal(body.cursor,undefined);return Response.json({objects:[objeto('1')],folders:[],hasNext:true,nextCursor:'ficticio'});}
    assert.equal(body.cursor,'ficticio');return Response.json({objects:[objeto('2')],folders:[],hasNext:false});
  }});
  assert.equal(calls,2);assert.deepEqual(result.map(o=>o.id),['1','2']);
});
test('falha de permissão, cursor repetido e objeto duplicado não são ignorados',async()=>{
  await assert.rejects(listarStorageAtual({...options,fetchImpl:async()=>new Response(null,{status:403})}),/LISTAGEM_HTTP_403/);
  let calls=0;
  await assert.rejects(listarStorageAtual({...options,fetchImpl:async()=>Response.json({objects:[objeto(String(++calls))],hasNext:true,nextCursor:'repetido'})}),/LISTAGEM_CURSOR_INVALIDO/);
  await assert.rejects(listarStorageAtual({...options,fetchImpl:async()=>Response.json({objects:[objeto('1'),objeto('1')],hasNext:false})}),/LISTAGEM_INCONSISTENTE/);
});
