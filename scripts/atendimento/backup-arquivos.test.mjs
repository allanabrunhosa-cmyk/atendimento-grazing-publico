import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copiarObjeto, hashArquivo, urlObjeto } from './backup-arquivos.mjs';

const origem = 'https://teste-ficticio.supabase.co';
const objeto = {id: 'ficticio', bucket: 'whatsapp-media', name: 'exemplo/anexo.txt', metadata: {size: 3}, version: '1'};
test('preserva bytes reais, deduplica apenas com hash e denuncia tamanho divergente', async () => {
  const destino = await mkdtemp(join(tmpdir(), 'donatella-arquivo-teste-'));
  try {
    const options = {origem, chavePublica: 'ficticia', objeto, destino, fetchImpl: async () => new Response('abc')};
    const first = await copiarObjeto(options); const second = await copiarObjeto(options);
    assert.equal(first.sha256, second.sha256); assert.equal(first.tamanhoCoincide, true);
    assert.equal((await readFile(join(destino, first.arquivo))).toString(), 'abc');
    assert.deepEqual(await hashArquivo(join(destino, first.arquivo)), {hash: first.sha256, bytes: 3});
    assert.equal((await copiarObjeto({...options, fetchImpl: async () => new Response('abcd')})).tamanhoCoincide, false);
    await writeFile(join(destino, first.arquivo), 'corrompido');
    await assert.rejects(copiarObjeto(options), /COPIA_EXISTENTE_CORROMPIDA/);
    assert.equal((await readdir(destino)).filter(n => n.endsWith('.parcial')).length, 0);
  } finally { await rm(destino, {recursive: true, force: true}); }
});
test('falha HTTP ou stream interrompido não vira cópia concluída', async () => {
  const destino = await mkdtemp(join(tmpdir(), 'donatella-arquivo-teste-'));
  try {
    const options = {origem, chavePublica: 'ficticia', objeto, destino};
    await assert.rejects(copiarObjeto({...options, fetchImpl: async () => new Response(null, {status: 404})}), /HTTP_404/);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.error(new Error('interrompido')); } });
    await assert.rejects(copiarObjeto({...options, fetchImpl: async () => new Response(stream)}));
    assert.deepEqual(await readdir(destino), []);
  } finally { await rm(destino, {recursive: true, force: true}); }
});
test('limita origem e buckets sem permitir navegação de caminhos', () => {
  for (const url of ['http://teste.supabase.co','https://outro.example','https://teste.supabase.co?token=teste']) assert.throws(() => urlObjeto(url, objeto));
  for (const name of ['../segredo','exemplo/../segredo','/absoluto']) assert.throws(() => urlObjeto(origem, {...objeto, name}));
  assert.throws(() => urlObjeto(origem, {...objeto, bucket: 'privado'}));
});
