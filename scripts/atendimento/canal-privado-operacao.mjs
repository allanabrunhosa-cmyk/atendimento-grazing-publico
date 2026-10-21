import { open, readFile } from 'node:fs/promises';

const idMeta = /^\d{5,30}$/;
const objeto = valor => !!valor && typeof valor === 'object' && !Array.isArray(valor);

// O shape é o da configuração privada já conferida. Nenhum ID tem fallback.
export function analisarCanalPrivado(entrada, appIdOrigem) {
  const meta = objeto(entrada) && entrada.meta;
  if (!objeto(meta) || !['appId', 'wabaId', 'phoneId'].every(campo => typeof meta[campo] === 'string' && idMeta.test(meta[campo])) || typeof meta.graphVersion !== 'string' || !/^v\d{1,2}\.0$/.test(meta.graphVersion)) throw Error('META_CANAL_PRIVADO_INVALIDO');
  if (typeof appIdOrigem !== 'string' || !idMeta.test(appIdOrigem) || meta.appId !== appIdOrigem) throw Error('META_CANAL_APP_DIVERGENTE');
  return { appId: meta.appId, wabaId: meta.wabaId, phoneId: meta.phoneId, graphVersion: meta.graphVersion };
}

export async function lerCanalPrivado(caminho, appIdOrigem) {
  if (typeof caminho !== 'string' || !caminho.trim()) throw Error('META_CANAL_PRIVADO_OBRIGATORIO');
  const bytes = await readFile(caminho);
  try {
    if (bytes.length === 0 || bytes.length > 1024 * 1024) throw Error('META_CANAL_PRIVADO_INVALIDO');
    return analisarCanalPrivado(JSON.parse(bytes.toString('utf8')), appIdOrigem);
  } finally { bytes.fill(0); }
}

// A consulta GET pertence à WABA privada. Paginação incompleta não prova o vínculo.
export function conferirNumeroDoCanal(resposta, canal) {
  if (!objeto(resposta) || !Array.isArray(resposta.data) || resposta.paging?.next || resposta.data.filter(item => objeto(item) && item.id === canal.phoneId).length !== 1) throw Error('META_CANAL_NUMERO_NAO_CONFIRMADO');
  return true;
}

export async function gravarArquivoPrivadoExclusivo(caminho, texto) {
  const arquivo = await open(caminho, 'wx', 0o600);
  try { await arquivo.writeFile(texto); await arquivo.sync(); }
  finally { await arquivo.close(); }
}
