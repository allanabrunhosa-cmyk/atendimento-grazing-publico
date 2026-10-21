// Apenas RPCs de leitura autorizados. Nunca chama confirmar ou escreve dados de negócio.
import { randomUUID } from 'node:crypto';
import { open, lstat } from 'node:fs/promises';
import { resolve, join, dirname, parse } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function validarCaptura(config, fetchImpl = fetch) {
  const origem = new URL(config.ATENDIMENTO_ORIGEM_URL);
  const token = config.ATENDIMENTO_ORIGEM_COLETOR_TOKEN, publico = config.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY;
  if (origem.protocol !== 'https:' || origem.username || origem.password || origem.search || origem.hash || origem.pathname !== '/' ||
    !/^[a-z0-9-]+\.supabase\.co$/.test(origem.hostname) || !/^[a-f0-9]{64}$/.test(token) || typeof publico !== 'string' || !publico || publico.length > 8192) throw new Error('CONFIGURACAO_INVALIDA');
  const prova = { versao: 1, instante: new Date().toISOString(), confirmacoes: 0, escritasNegocio: 0,
    continuidadeRpc: false, snapshotRpc: false, semTokenNegado: false, tokenErradoNegado: false, consultas: [] };
  async function consultar(nome, rpc, parametros, credencial) {
    try {
      const r = await fetchImpl(new URL(`/rest/v1/rpc/donatella_migracao_${rpc}`, origem), {
        method: 'POST', headers: { apikey: publico, 'Content-Type': 'application/json', ...(credencial ? { 'x-donatella-coletor': credencial } : {}) },
        body: JSON.stringify(parametros), redirect: 'error', signal: AbortSignal.timeout(30000), cache: 'no-store',
      });
      if (!r.body) throw new Error();
      const reader = r.body.getReader(), partes = []; let n = 0;
      try { for (;;) { const p = await reader.read(); if (p.done) break; n += p.value.length;
        if (n > 32 * 1024 * 1024) { await reader.cancel(); throw new Error(); } partes.push(p.value); }
      } finally { reader.releaseLock(); }
      const corpo = JSON.parse(Buffer.concat(partes).toString('utf8'));
      const estado = { consulta: nome, http: r.status, ok: r.ok, bytes: n,
        codigo: typeof corpo?.code === 'string' && /^[A-Z0-9]{1,20}$/.test(corpo.code) ? corpo.code : null };
      prova.consultas.push(estado); return { estado, corpo };
    } catch { prova.consultas.push({ consulta: nome, ok: false, falha: 'REDE_OU_RESPOSTA_INVALIDA' }); return null; }
  }
  const lote = await consultar('continuidade', 'ler_lote', { limite: 1 }, token);
  if (!lote?.estado.ok || !Array.isArray(lote.corpo) || lote.corpo.length > 1 || lote.corpo.some(t =>
    typeof t.id !== 'string' || !/^[a-f0-9-]{36}$/.test(t.id) || !Array.isArray(t.eventos) || !t.eventos.length)) return prova;
  prova.continuidadeRpc = true; prova.transacoesObservadas = lote.corpo.length;
  prova.eventosObservados = lote.corpo.reduce((n, t) => n + t.eventos.length, 0);
  const snapshot = await consultar('snapshot', 'snapshot', { esquema: 'storage', tabela: 'buckets', apos: null, limite: 1 }, token);
  const p = snapshot?.corpo;
  prova.snapshotRpc = snapshot?.estado.ok === true && p?.schema === 'storage' && p?.tabela === 'buckets' &&
    Array.isArray(p.registros) && p.registros.length <= 1 && typeof p.fim === 'boolean';
  const ausente = await consultar('sem_token', 'ler_lote', { limite: 1 }, null);
  const errado = await consultar('token_errado', 'ler_lote', { limite: 1 }, token === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64));
  const negado = r => !!r && [401, 403].includes(r.estado.http) && r.estado.codigo === '42501';
  prova.semTokenNegado = negado(ausente); prova.tokenErradoNegado = negado(errado);
  return prova;
}
async function cli() {
  if (process.argv.length !== 2) throw new Error();
  const partes = []; let n = 0;
  try {
    for await (const p of process.stdin) { n += p.length; if (n > 32768) throw new Error(); partes.push(p); }
    const entrada = JSON.parse(Buffer.concat(partes).toString('utf8'));
    const raiz = resolve(entrada.cofre); let ancestral = raiz;
    for (;;) { if ((await lstat(ancestral)).isSymbolicLink()) throw new Error();
      if (await lstat(join(ancestral, '.git')).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) throw new Error();
      if (ancestral === parse(ancestral).root) break; ancestral = dirname(ancestral); }
    const prova = await validarCaptura(entrada.config);
    const destino = join(raiz, `captura-validacao-${randomUUID()}.json`), f = await open(destino, 'wx', 0o600);
    try { await f.writeFile(JSON.stringify(prova, null, 2)); await f.sync(); } finally { await f.close(); }
    console.log(JSON.stringify({ comprovante: destino, ...prova }));
  } finally { for (const p of partes) p.fill(0); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  cli().catch(() => { console.error('VALIDACAO_CAPTURA_INTERROMPIDA: conferir privadamente acesso; nenhum payload registrado.'); process.exitCode = 1; });
