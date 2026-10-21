// Formato portátil para configuração privada; não depende de DPAPI ou de contas HUB.
// A chave deve ficar em outro meio privado. Este módulo não cria/guarda essa chave.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const limite = 1024 * 1024;
const contexto = Buffer.from('donatella-cofre-portatil:v1:aes-256-gcm');
function validarChave(chave) {
  if (!Buffer.isBuffer(chave) || chave.length !== 32) throw new Error('COFRE_CHAVE_INVALIDA');
}
function binario(texto, tamanho) {
  if (typeof texto !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(texto)) throw new Error();
  const valor = Buffer.from(texto, 'base64');
  if (valor.toString('base64') !== texto || (tamanho !== undefined && valor.length !== tamanho)) throw new Error();
  return valor;
}
export function selarConfiguracao(conteudo, chave) {
  validarChave(chave);
  if (!Buffer.isBuffer(conteudo) || conteudo.length === 0 || conteudo.length > limite) throw new Error('COFRE_CONTEUDO_INVALIDO');
  const nonce = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chave, nonce);
  cifra.setAAD(contexto);
  const cifrado = Buffer.concat([cifra.update(conteudo), cifra.final()]);
  return JSON.stringify({versao:1, algoritmo:'aes-256-gcm', nonce:nonce.toString('base64'), tag:cifra.getAuthTag().toString('base64'), cifrado:cifrado.toString('base64')});
}
export function recuperarConfiguracao(arquivo, chave) {
  validarChave(chave);
  try {
    if (typeof arquivo !== 'string' || Buffer.byteLength(arquivo) > limite * 2) throw new Error();
    const dados = JSON.parse(arquivo);
    if (!dados || Array.isArray(dados) || Object.keys(dados).sort().join(',') !== 'algoritmo,cifrado,nonce,tag,versao' || dados.versao !== 1 || dados.algoritmo !== 'aes-256-gcm') throw new Error();
    const cifrado = binario(dados.cifrado);
    if (!cifrado.length || cifrado.length > limite) throw new Error();
    const cifra = createDecipheriv('aes-256-gcm', chave, binario(dados.nonce,12));
    cifra.setAAD(contexto);
    cifra.setAuthTag(binario(dados.tag,16));
    const partes = [];
    try {
      partes.push(cifra.update(cifrado));
      partes.push(cifra.final());
      return Buffer.concat(partes);
    } finally { for (const parte of partes) parte.fill(0); }
  } catch { throw new Error('COFRE_RECUPERACAO_RECUSADA'); }
}
