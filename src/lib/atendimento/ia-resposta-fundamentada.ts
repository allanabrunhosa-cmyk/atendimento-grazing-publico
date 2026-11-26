import type { FonteIA } from './ia-orquestrador';
import { semPessoasInformadas } from './pessoas-informadas';

export const MOTIVO_RESPOSTA_REDIGIDA = 'RESPOSTA_REDIGIDA_FUNDAMENTADA';
const normalizar = (v: string) => v.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const padraoNumero = /\d+(?:[.,:/-]\d+)*(?:h\d*)?/gu;
const padraoEndereco = /(?:https?:\/\/|www\.)[^\s<>"'\])}]+|[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/giu;
/** Endereço sem protocolo, "www.", pontuação final ou barra final, para comparar
 * inteiro: um pedaço de link ("…/produto/mesa" de "…/produto/mesa-10") não é o link. */
const endereco = (v: string) => v.replace(/^https?:\/\//iu, '').replace(/^www\./iu, '').replace(/[.,;:!?…*_~]+$/u, '').replace(/\/+$/u, '');
const enderecos = (v: string) => new Set((v.match(padraoEndereco) ?? []).map(endereco));
const condicoesRestritas = [
  /\bgratis\b/gu, /\bgratuit[oa]s?\b/gu, /\bsem custo\b/gu,
  /\bdescontos?\b/gu, /\bestornos?\b/gu, /\breembolsos?\b/gu,
  /\b(?:pedido|pagamento|reserva|entrega) (?:(?:esta|foi|ja esta) )?confirmad[oa]\b/gu,
  /\b(?:garantid[oa]|garantimos|garanto)\b/gu,
  /\br\$/gu, /\b(?:usd|reais|centavos|dolares)\b/gu,
];

/** A versão, vigência, identidade e origem das fontes são verificadas pelo
 * orquestrador. Esta guarda adicional recusa identificadores e condições novos.
 * Não usa o histórico, a pergunta ou o perfil de estilo como fonte factual. A
 * única exceção é repetir quantas pessoas o cliente disse ("30 pessoas"). */
export function validarTextoRedigidoIA(texto: unknown, fontes: readonly FonteIA[], pessoas: ReadonlySet<string> = new Set()): texto is string {
  if (typeof texto !== 'string' || texto !== texto.trim() || !texto || texto.length > 2000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(texto) || texto.includes('```') ||
    /\b(?:sk-ant-|sk_live_|Bearer\s+\S+|(?:api[_ -]?key|secret|password|senha|token)\s*[:=]\s*\S{8,})/iu.test(texto) ||
    /<(?:script|iframe)|\b(?:sudo|curl|wget|powershell|cmd\.exe)\b|\b(?:DROP|DELETE|UPDATE|INSERT)\s+(?:TABLE|FROM|INTO)\b/iu.test(texto)) return false;
  if (!fontes.length || fontes.some(f => typeof f.conteudo !== 'string')) return false;
  const fatos = fontes.map(f => normalizar(f.conteudo)).join('\n'), resposta = normalizar(texto);
  // "R$ 480" e "R$ 480,00" são o mesmo valor; qualquer outro centavo não é.
  const numeros = new Set((fatos.match(padraoNumero) ?? []).flatMap(v => [v, v.replace(/[.,]00$/u, '')]));
  if ((semPessoasInformadas(resposta, pessoas).match(padraoNumero) ?? []).some(v => !numeros.has(v))) return false;
  const permitidos = enderecos(fontes.map(f => f.conteudo).join('\n'));
  if ([...enderecos(texto)].some(v => !permitidos.has(v))) return false;
  return condicoesRestritas.every(p => [...resposta.matchAll(p)].every(v => fatos.includes(v[0])));
}

/** Nome citado: todas as palavras e números do nome aparecem no texto, em
 * qualquer ordem e sem depender de traço, parênteses ou plural do artigo. */
const palavras = (v: string) => normalizar(v).replace(/(\d+)\s*un(?:idades?)?\b/gu, '$1 ').match(/[\p{L}\p{N}]+/gu) ?? [];
const LIGACAO = new Set('a o as os de da do das dos e em no na com para'.split(' '));
function produtoCitado(nome: string, ditas: ReadonlySet<string>) {
  const partes = palavras(nome.replace(/\([^)]*\)/g, ' ')).filter(p => !LIGACAO.has(p));
  return partes.length > 0 && partes.every(p => ditas.has(p));
}
export const produtosCitados = (texto: string, fontes: readonly FonteIA[]): FonteIA[] => { const ditas = new Set(palavras(texto)); return fontes.filter(f => f.compra && produtoCitado(f.compra.nome, ditas)); };
/** Endereço citado sem a fonte indicada: a fonte já consultada que o contém entra como prova. */
export function fontesDosEnderecos(texto: string, fontes: readonly FonteIA[]): FonteIA[] {
  const citados = enderecos(texto);
  return citados.size ? fontes.filter(f => typeof f.conteudo === 'string' && [...enderecos(f.conteudo)].some(v => citados.has(v))) : [];
}
const QUANTIDADE_NA_LINHA = /^(\s*(?:[•·▪►*–—-]\s+)?\*?)\d{1,3}\s*[x×]\s*/u;
/** Item de composição vai com a quantidade da referência. A IA não recalcula para o
 * grupo do cliente: "3× Grazing para 10" vira a quantidade que está na fonte. */
export function ajustarQuantidades(texto: string, fontes: readonly FonteIA[]): string {
  const itens = produtosCitados(texto, fontes).filter(f => f.compra?.quantidade).sort((a, b) => palavras(b.compra!.nome).length - palavras(a.compra!.nome).length);
  if (!itens.length) return texto;
  return texto.split('\n').map(linha => {
    if (!ITEM_DE_LISTA.test(linha)) return linha;
    const ditas = new Set(palavras(linha)), item = itens.find(f => produtoCitado(f.compra!.nome, ditas));
    return item ? linha.replace(QUANTIDADE_NA_LINHA, (_m, antes: string) => `${antes}${item.compra!.quantidade}× `) : linha;
  }).join('\n');
}
/** Cliente já disse o bastante e a resposta não citou nenhum produto: as opções vão
 * mesmo assim, uma vez por conversa, para a pessoa poder ver preço e link. */
export function completarSugestoes(texto: string, fontes: readonly FonteIA[], jaEnviado: string): FonteIA[] {
  const opcoes = fontes.filter(f => f.compra?.sugerir), enviados = enderecos(jaEnviado), presentes = enderecos(texto);
  if (!opcoes.length || produtosCitados(texto, fontes).length || opcoes.some(f => enviados.has(endereco(f.compra!.url)) || presentes.has(endereco(f.compra!.url)))) return [];
  return opcoes;
}
const ITEM_DE_LISTA = /^\s*(?:[•·▪►*–—-]\s|\d{1,2}[.)]\s|\*?\d{1,2}\s*[x×]\s)/u;
const nomeVisivel = (nome: string) => nome.replace(/\s*\([^)]*\)/g, '').trim();
const temPreco = (trecho: string, preco: string) => { const valor = preco.match(/\d[\d.]*(?:,\d{2})?/)?.[0] ?? ''; return !!valor && (trecho.includes(valor) || trecho.includes(valor.replace(/,00$/, ''))); };
/** O pedido é feito no site: produto citado na resposta vai sempre com preço e link
 * oficiais, mesmo que o modelo esqueça. Na lista, entram na linha do produto; fora
 * dela, ao fim. Usa só dados das fontes e preserva o texto se não couber. */
export function incluirLinksCompra(texto: string, fontes: readonly FonteIA[], sugestoes: readonly FonteIA[] = []): string {
  const linhas = texto.split('\n'), presentes = enderecos(texto), fim: string[] = [];
  for (const { compra } of produtosCitados(texto, fontes)) {
    if (!compra || presentes.has(endereco(compra.url))) continue;
    const i = linhas.findIndex(l => ITEM_DE_LISTA.test(l) && produtoCitado(compra.nome, new Set(palavras(l.split('\n')[0]))));
    const preco = compra.preco && !temPreco(i >= 0 ? linhas[i] : texto, compra.preco) ? ` — ${compra.preco}` : '';
    if (i >= 0) linhas[i] = `${linhas[i].trimEnd()}${preco}\n${compra.url}`;
    else fim.push(`${nomeVisivel(compra.nome)}${preco}: ${compra.url}`);
  }
  const referencia = sugestoes.find(f => f.compra?.referencia)?.compra?.referencia;
  const lista = sugestoes.flatMap(f => f.compra ? [`• ${f.compra.quantidade ? `${f.compra.quantidade}× ` : ''}${nomeVisivel(f.compra.nome)}${f.compra.preco ? ` — ${f.compra.preco}` : ''}\n${f.compra.url}`] : []);
  const partes = [linhas.join('\n'), ...(fim.length ? [`Para pedir pelo site:\n${fim.join('\n')}`] : []), ...(lista.length ? [`${referencia ? `Uma composição de referência para ${referencia} pessoas, que dá para ajustar:` : 'Algumas opções para você ver no site:'}\n${lista.join('\n')}`] : [])];
  const completo = partes.join('\n\n');
  return completo.length <= 2000 ? completo : texto;
}
