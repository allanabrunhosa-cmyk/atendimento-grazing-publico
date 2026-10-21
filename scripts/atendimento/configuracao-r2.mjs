// Somente o formulário privado passa por esta função; erros nunca incluem valores.
const campos = ['ACCOUNT_ID', 'ENDPOINT', 'BUCKET', 'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'];
export function analisarConfiguracaoR2(texto) {
  if (typeof texto !== 'string' || Buffer.byteLength(texto) > 8192) throw Error('R2_FORMULARIO_INVALIDO');
  const valores = new Map();
  for (const linha of texto.split(/\r?\n/)) {
    if (!linha.trim() || linha.trimStart().startsWith('#')) continue;
    const correspondencia = /^([A-Z_]+)=([^\s]+)$/.exec(linha);
    if (!correspondencia || !campos.includes(correspondencia[1]) || valores.has(correspondencia[1])) throw Error('R2_FORMULARIO_INVALIDO');
    valores.set(correspondencia[1], correspondencia[2]);
  }
  if (campos.some(campo => !valores.has(campo))) throw Error('R2_FORMULARIO_INCOMPLETO');
  const conta = valores.get('ACCOUNT_ID');
  if (!/^[a-f0-9]{32}$/.test(conta)) throw Error('R2_CONTA_INVALIDA');
  let endpoint;
  try { endpoint = new URL(valores.get('ENDPOINT')); } catch { throw Error('R2_ENDPOINT_INVALIDO'); }
  const hosts = ['', '.eu', '.us', '.fedramp'].map(jurisdicao => `${conta}${jurisdicao}.r2.cloudflarestorage.com`);
  if (endpoint.protocol !== 'https:' || !hosts.includes(endpoint.hostname) || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw Error('R2_ENDPOINT_INVALIDO');
  if (valores.get('BUCKET') !== 'grazing-donatella-backups' || valores.get('REGION') !== 'auto') throw Error('R2_DESTINO_INVALIDO');
  if (!/^[A-Za-z0-9]{16,128}$/.test(valores.get('ACCESS_KEY_ID')) || !/^[A-Za-z0-9/+_=.-]{32,256}$/.test(valores.get('SECRET_ACCESS_KEY'))) throw Error('R2_CREDENCIAL_INVALIDA');
  return { provedor: 'cloudflare-r2-standard', accountId: conta, endpoint: endpoint.href, bucket: valores.get('BUCKET'), regiao: 'auto', accessKey: valores.get('ACCESS_KEY_ID'), secretKey: valores.get('SECRET_ACCESS_KEY'), prefixo: 'donatella-v2' };
}
