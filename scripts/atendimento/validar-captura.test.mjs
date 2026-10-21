import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCaptura } from './validar-captura.mjs';
const config = { ATENDIMENTO_ORIGEM_URL: 'https://ficticio.supabase.co', ATENDIMENTO_ORIGEM_COLETOR_TOKEN: 'a'.repeat(64), ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY: 'publico-ficticio' };
test('valida continuidade/snapshot e negativas sem confirmar ou expor payload', async () => {
  const chamadas = [];
  const p = await validarCaptura(config, async (url, options) => {
    chamadas.push(String(url)); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.ok(!String(url).includes(config.ATENDIMENTO_ORIGEM_COLETOR_TOKEN));
    if (options.headers['x-donatella-coletor'] !== config.ATENDIMENTO_ORIGEM_COLETOR_TOKEN)
      return Response.json({ code: '42501', message: 'erro privado fictício' }, { status: 401 });
    return Response.json(String(url).endsWith('snapshot') ? { schema: 'storage', tabela: 'buckets', registros: [], fim: true }
      : [{ id: '00000000-0000-4000-8000-000000000001', eventos: [{ posterior: { segredo: 'dado-ficticio' } }] }]);
  });
  assert.equal(chamadas.length, 4); assert.ok(chamadas.every(u => !u.includes('confirmar')));
  assert.equal(p.continuidadeRpc, true); assert.equal(p.snapshotRpc, true);
  assert.equal(p.semTokenNegado, true); assert.equal(p.tokenErradoNegado, true); assert.equal(p.confirmacoes, 0);
  assert.ok(!JSON.stringify(p).includes('dado-ficticio'));
});
test('falha de continuidade/rede não libera validação e não consulta outros RPCs', async () => {
  let n = 0; const p = await validarCaptura(config, async () => { n++; throw new Error('segredo-ficticio'); });
  assert.equal(n, 1); assert.equal(p.continuidadeRpc, false); assert.ok(!JSON.stringify(p).includes('segredo-ficticio'));
});
test('não confunde 500 com acesso negado ou schema inesperado com snapshot válido', async () => {
  let n = 0;
  const p = await validarCaptura(config, async () => ++n === 1 ? Response.json([]) : n === 2
    ? Response.json({ schema: 'auth', tabela: 'users', registros: [], fim: true }) : Response.json({ code: 'XX000' }, { status: 500 }));
  assert.equal(p.snapshotRpc, false); assert.equal(p.semTokenNegado, false); assert.equal(p.tokenErradoNegado, false);
});
test('origem externa é recusada antes da rede', async () => {
  await assert.rejects(() => validarCaptura({ ...config, ATENDIMENTO_ORIGEM_URL: 'https://example.com' }, () => { throw new Error('Não chamar'); }), /CONFIGURACAO_INVALIDA/);
});
