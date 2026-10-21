import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, statfs, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { urlObjeto } from './storage-objeto.mjs';
export { urlObjeto } from './storage-objeto.mjs';

const BUCKETS = new Set(['whatsapp-media', 'audio-messages']);
const RESERVA = 768n * 1024n * 1024n;

export async function hashArquivo(path) {
  if (!(await lstat(path)).isFile()) throw new Error('ARQUIVO_FISICO_INVALIDO');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { hash: hash.digest('hex'), bytes };
}

export async function copiarObjeto({ origem, chavePublica, objeto, destino, fetchImpl = fetch }) {
  const url = urlObjeto(origem, objeto);
  const esperado = Number(objeto.metadata?.size);
  if (!Number.isSafeInteger(esperado) || esperado < 0 || esperado > 256 * 1024 * 1024) throw new Error('TAMANHO_INVALIDO');
  const parcial = join(destino, `${randomUUID()}.parcial`);
  const hash = createHash('sha256'); let bytes = 0;
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error',
      headers: { apikey: chavePublica }, signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) {
      const error = new Error(`HTTP_${response.status}`);
      const retry = response.headers.get('Retry-After');
      error.retryAfterMs = response.status === 429 ? 60_000 : 0;
      if (retry) {
        const delay = /^\d+$/.test(retry) ? Number(retry)*1000 : Date.parse(retry)-Date.now();
        if (Number.isFinite(delay) && delay > 0) error.retryAfterMs = Math.min(delay,300_000);
      }
      throw error;
    }
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > 256 * 1024 * 1024) return callback(new Error('OBJETO_MUITO_GRANDE'));
      hash.update(chunk); callback(null, chunk);
    } }), createWriteStream(parcial, { flags: 'wx', mode: 0o600 }));
    const sha256 = hash.digest('hex');
    const arquivo = `${sha256}.bin`; const completo = join(destino, arquivo);
    // Nenhuma versão existente é sobrescrita; deduplicação somente após reler bytes.
    try {
      await lstat(completo);
      const existente = await hashArquivo(completo);
      if (existente.hash !== sha256 || existente.bytes !== bytes) throw new Error('COPIA_EXISTENTE_CORROMPIDA');
      await unlink(parcial);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await rename(parcial, completo);
    }
    const file = await open(completo, 'r+'); try { await file.sync(); } finally { await file.close(); }
    return { id: objeto.id, bucket: objeto.bucket, name: objeto.name, updatedAt: objeto.updatedAt,
      version: objeto.version, metadata: objeto.metadata, bytes, sha256, arquivo,
      tamanhoCoincide: bytes === esperado, copiadoEm: new Date().toISOString() };
  } catch (error) {
    // Só o fragmento criado por esta chamada, dentro do destino privado.
    try { await unlink(parcial); } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; }
    throw error;
  }
}

async function validarDiretorio(root) {
  if (!isAbsolute(root) || resolve(root) !== root) throw new Error('DIRETORIO_INVALIDO');
  for (let ancestor = root; ancestor; ancestor = dirname(ancestor)) {
    if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('ATALHO_RECUSADO');
    try { await lstat(join(ancestor, '.git')); throw new Error('BACKUP_EM_GIT_RECUSADO'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(ancestor) === ancestor) break;
  }
}

async function executar() {
  if (process.argv.length > 4) throw new Error('ARGUMENTO_INVALIDO');
  const root = resolve(process.argv[2] ?? ''); await validarDiretorio(root);
  const origem = process.env.ATENDIMENTO_ORIGEM_URL;
  const chavePublica = process.env.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY;
  if (!origem || !chavePublica) throw new Error('CONFIGURACAO_PRIVADA_AUSENTE');
  const manifestoAtual = process.argv[3];
  if (manifestoAtual && !/^storage-live-[a-f0-9-]{36}\.json$/.test(manifestoAtual)) throw new Error('MANIFESTO_INVALIDO');
  const manifesto = JSON.parse(await readFile(join(root, 'banco',manifestoAtual ?? 'storage-export-privado.json'), 'utf8'));
  if (!Array.isArray(manifesto.objetos) || manifesto.buckets.some(b => BUCKETS.has(b.id) && b.public !== true)) throw new Error('BUCKET_PRIVADO_REQUER_ACESSO_EXISTENTE');
  if (manifesto.objetos.some(o => !BUCKETS.has(o.bucket))) throw new Error('BUCKET_ADICIONAL_NAO_COPIADO');
  const destino = join(root, 'midia');
  try { await mkdir(destino, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!(await lstat(destino)).isDirectory() || (await lstat(destino)).isSymbolicLink()) throw new Error('ATALHO_RECUSADO');
  const indice = join(destino,manifestoAtual ? 'manifesto-atual.jsonl' : 'manifesto-inicial.jsonl');
  const anteriores = new Map();
  for (const nome of manifestoAtual ? ['manifesto-inicial.jsonl','manifesto-atual.jsonl'] : ['manifesto-inicial.jsonl']) {
    try {
      for (const line of (await readFile(join(destino,nome), 'utf8')).split('\n').filter(Boolean)) {
        const row = JSON.parse(line); anteriores.set(`${row.bucket}/${row.name}`, row);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const mesmaVersao = (objeto,anterior) => anterior && anterior.id === objeto.id &&
    anterior.metadata?.eTag === objeto.metadata?.eTag && Number(anterior.metadata?.size) === Number(objeto.metadata?.size) &&
    Date.parse(anterior.updatedAt) === Date.parse(objeto.updatedAt) &&
    (!anterior.version || !objeto.version || anterior.version === objeto.version);
  const faltantes = manifesto.objetos.filter(o => !mesmaVersao(o,anteriores.get(`${o.bucket}/${o.name}`)));
  const capacidade = await statfs(root, { bigint: true });
  const necessario = faltantes.reduce((v, o) => v + BigInt(o.metadata?.size ?? 0), 0n);
  if (capacidade.bavail * capacidade.bsize < necessario + RESERVA) throw new Error('CAPACIDADE_INSUFICIENTE');
  const log = await open(indice, 'a', 0o600); let sucesso = 0; let falhas = 0; let divergentes = 0;
  let escrita = Promise.resolve(); let aguardarAte = 0;
  const registrar = async (record) => {
    escrita = escrita.then(async () => { await log.write(`${JSON.stringify(record)}\n`); await log.sync(); });
    await escrita;
  };
  try {
    const processar = async (objeto) => {
      const anterior = anteriores.get(`${objeto.bucket}/${objeto.name}`);
      if (mesmaVersao(objeto,anterior)) {
        if (!/^[a-f0-9]{64}\.bin$/.test(anterior.arquivo)) throw new Error('MANIFESTO_INVALIDO');
        const prova = await hashArquivo(join(destino, anterior.arquivo));
        if (prova.hash !== anterior.sha256 || prova.bytes !== anterior.bytes) throw new Error('COPIA_EXISTENTE_CORROMPIDA');
        if (manifestoAtual) await registrar({...anterior,version:objeto.version,updatedAt:objeto.updatedAt,metadata:objeto.metadata,manifestoReferencia:manifestoAtual,reutilizadoAposHash:true});
        sucesso++; if (!anterior.tamanhoCoincide) divergentes++; return;
      }
      const livre = await statfs(root, { bigint: true });
      if (livre.bavail * livre.bsize < RESERVA + BigInt(objeto.metadata?.size ?? 0)) throw new Error('CAPACIDADE_INSUFICIENTE');
      let resultado; let ultimaFalha;
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        while (Date.now() < aguardarAte) await new Promise(done => setTimeout(done,Math.min(5000,aguardarAte-Date.now())));
        try { resultado = await copiarObjeto({ origem, chavePublica, objeto, destino }); break; }
        catch (error) {
          ultimaFalha = /^HTTP_\d+$/.test(error.message) ? error.message : 'COPIA_FALHOU';
          if (error.retryAfterMs) {
            aguardarAte = Math.max(aguardarAte,Date.now()+error.retryAfterMs);
            console.log(JSON.stringify({leituraPausada:true,motivo:ultimaFalha,tempoMs:error.retryAfterMs}));
          }
          if (tentativa < 2) await new Promise(done => setTimeout(done, 250 * (tentativa + 1)));
        }
      }
      if (resultado) {
        await registrar(resultado);
        sucesso++; if (!resultado.tamanhoCoincide) divergentes++;
      } else {
        // Identidade do objeto só no arquivo privado; falha nunca é ignorada.
        const fail = await open(join(destino, 'falhas-iniciais.jsonl'), 'a', 0o600);
        try { await fail.write(`${JSON.stringify({id: objeto.id, bucket: objeto.bucket, name: objeto.name, erro: ultimaFalha, time: new Date().toISOString()})}\n`); await fail.sync(); }
        finally { await fail.close(); }
        falhas++;
      }
      if ((sucesso + falhas) % 50 === 0) console.log(JSON.stringify({copiados: sucesso, falhas, divergentes, total: manifesto.objetos.length}));
    };
    // Quatro GETs no máximo; toda escrita do manifesto é serializada e fsync.
    // Aguarda inclusive leituras em andamento antes de propagar falha fatal.
    for (let position = 0; position < manifesto.objetos.length; position += 4) {
      const grupo = manifesto.objetos.slice(position, position + 4);
      const livre = await statfs(root, { bigint: true });
      const margem = grupo.reduce((v, o) => v + BigInt(o.metadata?.size ?? 0), 0n);
      if (livre.bavail * livre.bsize < RESERVA + margem) throw new Error('CAPACIDADE_INSUFICIENTE');
      const resultados = await Promise.allSettled(grupo.map(processar));
      if (resultados.some(r => r.status === 'rejected')) throw new Error('LOTE_FISICO_INTERROMPIDO');
    }
  } finally { await escrita; await log.close(); }
  const resumo = {time: new Date().toISOString(), copiados: sucesso, falhas, divergentes,
    total: manifesto.objetos.length, etapa: manifestoAtual ? 'backup-fisico-alteracoes' : 'backup-fisico-snapshot',
    recuperacaoVpsComprovada: false, reconciliacaoAlteracoesConcluida: false};
  const proof = await open(join(destino, `resumo-${randomUUID()}.json`), 'wx', 0o600);
  try { await proof.writeFile(JSON.stringify(resumo)); await proof.sync(); } finally { await proof.close(); }
  console.log(JSON.stringify(resumo));
  if (falhas || divergentes || sucesso !== manifesto.objetos.length) throw new Error('BACKUP_FISICO_INCOMPLETO');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  executar().catch(() => { console.error('BACKUP_ARQUIVOS_INTERROMPIDO: verificar evidência privada; nenhuma falha deve ser ignorada.'); process.exitCode = 1; });
}
