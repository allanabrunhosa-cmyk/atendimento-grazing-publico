import { LIMITE_LOTE_IMPORTACAO, type CategoriaFonteOficial, type ItemImportacaoConhecimento } from './operacao-api';

export const LIMITE_ITENS_IMPORTACAO = 500;
/** Folga abaixo dos 64 KB que o servidor aceita por pedido. */
const BYTES_POR_LOTE = 48000;
const CATEGORIAS: Record<string, CategoriaFonteOficial> = { procedimento: 'procedimento', produto: 'produto', politica: 'politica', 'política': 'politica' };

/** Aceita uma lista JSON de fontes, ou um objeto com `itens` ou `fontes`.
 * Só pergunta, resposta, categoria e condições seguem para o servidor. */
export function lerImportacaoConhecimento(texto: string): ItemImportacaoConhecimento[] {
  let dados: unknown;
  try { dados = JSON.parse(texto); } catch { throw new Error('O conteúdo não é um JSON válido.'); }
  const objeto = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados as Record<string, unknown> : null;
  const lista = Array.isArray(dados) ? dados : objeto ? objeto.itens ?? objeto.fontes : undefined;
  if (!Array.isArray(lista) || !lista.length) throw new Error('Nenhuma fonte encontrada. Use uma lista de objetos com pergunta e resposta.');
  if (lista.length > LIMITE_ITENS_IMPORTACAO) throw new Error(`Importe no máximo ${LIMITE_ITENS_IMPORTACAO} fontes por vez.`);
  return lista.map((item, n) => {
    const v = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const pergunta = typeof v?.pergunta === 'string' ? v.pergunta.trim() : '', resposta = typeof v?.resposta === 'string' ? v.resposta.trim() : '';
    if (!pergunta || !resposta) throw new Error(`A fonte ${n + 1} precisa de pergunta e resposta.`);
    const bruta = typeof v?.categoria === 'string' ? v.categoria.trim().toLocaleLowerCase('pt-BR') : 'procedimento';
    const categoria = CATEGORIAS[bruta];
    if (!categoria) throw new Error(`A fonte ${n + 1} tem uma categoria desconhecida. Use procedimento, produto ou política.`);
    const condicoes = typeof v?.condicoes === 'string' ? v.condicoes.trim() : '';
    return { pergunta, resposta, categoria, ...(condicoes ? { condicoes } : {}) };
  });
}

/** Lotes que cabem no limite do servidor: até 25 fontes e bem menos de 64 KB. */
export function dividirLotesImportacao<T>(itens: readonly T[]): T[][] {
  const codificador = new TextEncoder(), lotes: T[][] = [];
  let atual: T[] = [], bytes = 0;
  for (const item of itens) {
    const tamanho = codificador.encode(JSON.stringify(item)).length + 1;
    if (atual.length && (atual.length >= LIMITE_LOTE_IMPORTACAO || bytes + tamanho > BYTES_POR_LOTE)) { lotes.push(atual); atual = []; bytes = 0; }
    atual.push(item); bytes += tamanho;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

export function explicarRecusaImportacao(codigo?: string): string {
  if (codigo === 'CONHECIMENTO_DADOS_PESSOAIS') return 'tem telefone, e-mail ou CPF';
  if (codigo === 'CONHECIMENTO_CONFIRMACAO_TRIVIAL') return 'a resposta é curta demais';
  if (codigo === 'CONHECIMENTO_GENERALIZACAO_RECUSADA') return 'essa categoria não pode virar regra oficial';
  return 'algum campo está vazio, longo demais ou com caractere inválido';
}
