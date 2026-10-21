// Validação pura, compartilhada por executáveis e bibliotecas de arquivos.
// Não importa CLI, acessa rede ou inicia trabalho ao ser incluída em bundles.
const BUCKETS = new Set(['whatsapp-media', 'audio-messages']);

export function urlObjeto(origem, objeto) {
  const url = new URL(origem);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('ORIGEM_INVALIDA');
  if (!BUCKETS.has(objeto.bucket) || typeof objeto.name !== 'string' || !objeto.name || objeto.name.length > 2048 || objeto.name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('OBJETO_INVALIDO');
  return new URL(`/storage/v1/object/public/${objeto.bucket}/${objeto.name.split('/').map(encodeURIComponent).join('/')}`, url);
}
