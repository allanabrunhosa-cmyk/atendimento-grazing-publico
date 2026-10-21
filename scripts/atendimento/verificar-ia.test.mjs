import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferirIA } from './verificar-ia.mjs';
const chave = 'sk-ant-' + 'ficticia'.repeat(5);
const m = id => ({ type: 'model', id, max_input_tokens: 200000, max_tokens: 8192 });
test('consulta somente GET oficial e resolve alias sem enviar conteúdo', async () => {
  const chamadas = [];
  const prova = await conferirIA({ chave, modelos: ['claude-sonnet-ficticio'] }, async (url, options) => {
    chamadas.push(url); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.equal(options.headers['x-api-key'], chave); assert.equal(options.redirect, 'error');
    assert.ok(!url.includes(chave)); assert.ok(url.startsWith('https://api.anthropic.com/v1/models'));
    return Response.json(chamadas.length === 1 ? { data: [m('claude-sonnet-ficticio-fixo')], has_more: false } : m('claude-sonnet-ficticio-fixo'));
  });
  assert.equal(chamadas.length, 2); assert.equal(prova.credencialAceita, true);
  assert.equal(prova.configurados[0].id, 'claude-sonnet-ficticio-fixo'); assert.equal(prova.listaCompleta, true);
  assert.equal(prova.inferencias, 0); assert.ok(!JSON.stringify(prova).includes(chave));
});
test('nega entrada inválida sem rede e registra 401 sem erro sensível', async () => {
  await assert.rejects(() => conferirIA({ chave, modelos: ['../../messages'] }, () => { throw new Error('Não chamar'); }), /ENTRADA_IA_INVALIDA/);
  const prova = await conferirIA({ chave }, async () => Response.json({ error: { message: chave } }, { status: 401 }));
  assert.equal(prova.credencialAceita, false); assert.equal(prova.consultas[0].http, 401);
  assert.ok(!JSON.stringify(prova).includes(chave));
});
test('lista parcial explícita, modelo indisponível e limites de resposta', async () => {
  let n = 0;
  const prova = await conferirIA({ chave, modelos: ['claude-ausente'] }, async () => ++n === 1
    ? Response.json({ data: [m('claude-ficticio')], has_more: true }) : new Response('', { status: 404 }));
  assert.equal(prova.listaCompleta, false); assert.equal(prova.configurados[0].disponivel, false);
  const grande = await conferirIA({ chave }, async () => new Response('x'.repeat(1024 * 1024 + 1)));
  assert.equal(grande.credencialAceita, false); assert.equal(grande.consultas[0].ok, false);
});
test('rede/JSON inesperado não expõem exceções ou validam a chave', async () => {
  const rede = await conferirIA({ chave }, async () => { throw new Error(chave); });
  assert.ok(!JSON.stringify(rede).includes(chave)); assert.equal(rede.credencialAceita, false);
  const invalido = await conferirIA({ chave }, async () => Response.json({ data: [m('modelo-invalido')], has_more: false }));
  assert.equal(invalido.credencialAceita, false); assert.deepEqual(invalido.modelosDisponiveis, []);
});
