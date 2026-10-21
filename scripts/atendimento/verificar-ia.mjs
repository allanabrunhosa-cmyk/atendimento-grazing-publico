// GETs oficiais de modelos; sem inferência, prompts, clientes ou efeitos de negócio.
import { randomUUID } from 'node:crypto';
import { lstat, readFile, open } from 'node:fs/promises';
import { dirname, join, resolve, parse } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recuperarConfiguracao } from './cofre-portatil.mjs';

const modeloValido = v => typeof v === 'string' && /^claude-[a-z0-9-]{1,80}$/.test(v);
async function lerJson(r) {
  if (!r.body) throw new Error();
  const reader = r.body.getReader(), partes = []; let n = 0;
  try {
    for (;;) { const p = await reader.read(); if (p.done) break;
      n += p.value.length; if (n > 1024 * 1024) { await reader.cancel(); throw new Error(); }
      partes.push(p.value);
    }
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } finally { reader.releaseLock(); }
}
const resumirModelo = m => {
  if (!m || m.type !== 'model' || !modeloValido(m.id)) throw new Error();
  return { id: m.id, maxInputTokens: Number.isSafeInteger(m.max_input_tokens) && m.max_input_tokens > 0 ? m.max_input_tokens : null,
    maxTokens: Number.isSafeInteger(m.max_tokens) && m.max_tokens > 0 ? m.max_tokens : null };
};
export async function conferirIA({ chave, modelos = [] }, fetchImpl = fetch) {
  if (typeof chave !== 'string' || !/^sk-ant-[A-Za-z0-9_-]{20,500}$/.test(chave) ||
    !Array.isArray(modelos) || modelos.length > 4 || modelos.some(m => !modeloValido(m))) throw new Error('ENTRADA_IA_INVALIDA');
  const prova = { versao: 1, instante: new Date().toISOString(), somenteLeitura: true, inferencias: 0,
    mensagensClientes: 0, credencialAceita: false, listaCompleta: false, modelosDisponiveis: [], configurados: [], consultas: [] };
  async function consultar(nome, caminho) {
    try {
      const r = await fetchImpl(`https://api.anthropic.com/v1/models${caminho}`, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', Accept: 'application/json' },
      });
      // Erros do provedor nunca são lidos/ecoam credenciais ou conteúdos.
      if (!r.ok) { await r.body?.cancel(); prova.consultas.push({ consulta: nome, http: r.status, ok: false }); return null; }
      const corpo = await lerJson(r);
      prova.consultas.push({ consulta: nome, http: r.status, ok: true }); return corpo;
    } catch { prova.consultas.push({ consulta: nome, ok: false, falha: 'REDE_OU_RESPOSTA_INVALIDA' }); return null; }
  }
  const lista = await consultar('modelos', '?limit=100');
  try {
    if (!lista || !Array.isArray(lista.data) || lista.data.length > 100 || typeof lista.has_more !== 'boolean') throw new Error();
    prova.modelosDisponiveis = lista.data.map(resumirModelo);
    if (new Set(prova.modelosDisponiveis.map(m => m.id)).size !== lista.data.length) throw new Error();
    prova.credencialAceita = true; prova.listaCompleta = !lista.has_more;
  } catch { prova.modelosDisponiveis = []; prova.respostaListaValida = false; return prova; }
  for (const solicitado of [...new Set(modelos)]) {
    const resposta = await consultar('modelo_configurado', `/${solicitado}`);
    try { prova.configurados.push({ solicitado, disponivel: true, ...resumirModelo(resposta) }); }
    catch { prova.configurados.push({ solicitado, disponivel: false }); }
  }
  return prova;
}
async function cli() {
  if (process.argv.length !== 2) throw new Error();
  const partes = []; let n = 0, chave, origemBytes;
  try {
    for await (const p of process.stdin) { n += p.length; if (n > 16384) throw new Error(); partes.push(p); }
    const entrada = JSON.parse(Buffer.concat(partes).toString('utf8'));
    const raiz = resolve(entrada.cofre); let ancestral = raiz;
    for (;;) {
      if ((await lstat(ancestral)).isSymbolicLink()) throw new Error();
      if (await lstat(join(ancestral, '.git')).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) throw new Error();
      if (ancestral === parse(ancestral).root) break; ancestral = dirname(ancestral);
    }
    const caminho = resolve(entrada.origem), stat = await lstat(caminho);
    if (dirname(caminho) !== raiz || !stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error();
    chave = Buffer.from(entrada.chave, 'base64'); if (chave.length !== 32) throw new Error();
    origemBytes = recuperarConfiguracao(await readFile(caminho, 'utf8'), chave);
    const origem = JSON.parse(origemBytes.toString('utf8'));
    const linhas = [...(origem.nina_settings ?? []), ...(origem.system_settings ?? [])];
    const chaves = [...new Set(linhas.map(r => r.ai_api_keys?.anthropic).filter(v => typeof v === 'string' && v.trim()))];
    if (chaves.length !== 1) throw new Error();
    const modelos = [...new Set(linhas.filter(r => r.ai_provider === 'anthropic' && modeloValido(r.ai_model)).map(r => r.ai_model))];
    const prova = await conferirIA({ chave: chaves[0], modelos });
    const destino = join(raiz, `ia-verificacao-${randomUUID()}.json`), f = await open(destino, 'wx', 0o600);
    try { await f.writeFile(JSON.stringify(prova, null, 2)); await f.sync(); } finally { await f.close(); }
    console.log(JSON.stringify({ comprovante: destino, credencialAceita: prova.credencialAceita, listaCompleta: prova.listaCompleta,
      modelosDisponiveis: prova.modelosDisponiveis.length, configurados: prova.configurados,
      consultas: prova.consultas, inferencias: 0, mensagensClientes: 0 }));
  } finally { chave?.fill(0); origemBytes?.fill(0); for (const p of partes) p.fill(0); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  cli().catch(() => { console.error('VERIFICACAO_IA_INTERROMPIDA: conferir privadamente acesso/configuracao. Nenhuma credencial registrada.'); process.exitCode = 1; });
