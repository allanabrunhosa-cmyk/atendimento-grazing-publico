import type { FonteIA } from './ia-orquestrador';

export const MOTIVO_RESPOSTA_REDIGIDA = 'RESPOSTA_REDIGIDA_FUNDAMENTADA';
const normalizar = (v: string) => v.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const padraoNumero = /\d+(?:[.,:/-]\d+)*(?:h\d*)?/gu;
const padraoEndereco = /(?:https?:\/\/|www\.)[^\s<>"'\])}]+|[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/giu;
const condicoesRestritas = [
  /\bgratis\b/gu, /\bgratuit[oa]s?\b/gu, /\bsem custo\b/gu,
  /\bdescontos?\b/gu, /\bestornos?\b/gu, /\breembolsos?\b/gu,
  /\b(?:pedido|pagamento|reserva|entrega) (?:(?:esta|foi|ja esta) )?confirmad[oa]\b/gu,
  /\b(?:garantid[oa]|garantimos|garanto)\b/gu,
  /\br\$/gu, /\b(?:usd|reais|centavos|dolares)\b/gu,
];

/** A versão, vigência, identidade e origem das fontes são verificadas pelo
 * orquestrador. Esta guarda adicional recusa identificadores e condições novos.
 * Não usa o histórico, a pergunta ou o perfil de estilo como fonte factual. */
export function validarTextoRedigidoIA(texto: unknown, fontes: readonly FonteIA[]): texto is string {
  if (typeof texto !== 'string' || texto !== texto.trim() || !texto || texto.length > 2000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(texto) || texto.includes('```') ||
    /\b(?:sk-ant-|sk_live_|Bearer\s+\S+|(?:api[_ -]?key|secret|password|senha|token)\s*[:=]\s*\S{8,})/iu.test(texto) ||
    /<(?:script|iframe)|\b(?:sudo|curl|wget|powershell|cmd\.exe)\b|\b(?:DROP|DELETE|UPDATE|INSERT)\s+(?:TABLE|FROM|INTO)\b/iu.test(texto)) return false;
  if (!fontes.length || fontes.some(f => typeof f.conteudo !== 'string')) return false;
  const fatos = fontes.map(f => normalizar(f.conteudo)).join('\n'), resposta = normalizar(texto);
  const numeros = new Set(fatos.match(padraoNumero) ?? []);
  if ((resposta.match(padraoNumero) ?? []).some(v => !numeros.has(v))) return false;
  if ((texto.match(padraoEndereco) ?? []).some(v => !fontes.some(f => f.conteudo.includes(v)))) return false;
  return condicoesRestritas.every(p => [...resposta.matchAll(p)].every(v => fatos.includes(v[0])));
}
