/** Relevância lexical entre a pergunta do cliente e uma fonte de conhecimento.
 * Só ordena fontes que já passaram por aprovação, vigência e escopo. Não
 * aprova, não completa nem interpreta conteúdo. */

const PALAVRAS_VAZIAS = new Set([
  'para', 'pra', 'pro', 'por', 'com', 'sem', 'que', 'uma', 'uns', 'umas', 'dos', 'das', 'nos', 'nas', 'aos', 'num', 'numa',
  'voce', 'voces', 'vcs', 'mim', 'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas', 'nosso', 'nossa', 'nossos', 'nossas',
  'tem', 'ter', 'tenho', 'tinha', 'temos', 'vai', 'vou', 'vao', 'ser', 'sao', 'era', 'foi', 'esta', 'estao', 'estou', 'fica', 'ficar',
  'qual', 'quais', 'quanto', 'quanta', 'quantos', 'quantas', 'como', 'onde', 'quando', 'porque', 'pois', 'entao', 'sobre', 'ate', 'apos',
  'mais', 'menos', 'muito', 'muita', 'muitos', 'muitas', 'isso', 'esse', 'essa', 'esses', 'essas', 'este', 'estes', 'estas', 'aquele', 'aquela',
  'aqui', 'ali', 'tambem', 'mas', 'nao', 'sim', 'ola', 'boa', 'bom', 'dia', 'tarde', 'noite', 'obrigado', 'obrigada', 'favor',
  'gostaria', 'quero', 'queria', 'saber', 'pode', 'posso', 'podem', 'podemos', 'poderia', 'tudo', 'bem', 'fazer', 'faz', 'fazem',
  'gente', 'algum', 'alguma', 'alguns', 'algumas', 'ainda', 'cada', 'outro', 'outra', 'outros', 'outras', 'ele', 'ela', 'eles', 'elas',
]);

/** Raiz curta para aproximar plural e flexões comuns (entrega, entregam). */
function raiz(termo: string) {
  return termo.length > 5 ? termo.slice(0, 5) : termo.replace(/s$/u, '');
}

export function termosConhecimento(texto: string): string[] {
  const base = texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
  const termos = base.match(/[a-z0-9]+/gu) ?? [];
  return [...new Set(termos.filter(t => t.length >= 3 && !PALAVRAS_VAZIAS.has(t)).map(raiz))];
}

/** Termo presente na pergunta da fonte vale mais que termo só na resposta. */
export function pontuarConhecimento(pergunta: string, fonte: { pergunta: string; conteudo: string }): number {
  const alvo = termosConhecimento(pergunta);
  if (!alvo.length) return 0;
  const naPergunta = new Set(termosConhecimento(fonte.pergunta)), naResposta = new Set(termosConhecimento(fonte.conteudo));
  let pontos = 0;
  for (const termo of alvo) pontos += naPergunta.has(termo) ? 3 : naResposta.has(termo) ? 1 : 0;
  return pontos;
}

/** Ordena por pontuação. Fontes sem termo em comum não ficam de fora: perguntas
 * curtas ou coloquiais ("consigo para sexta?") quase não têm palavras em comum
 * com a resposta certa, e quem decide se a fonte serve é o modelo. Elas
 * completam a lista depois das pontuadas, primeiro as do tema (`doTema`).
 * Empate preserva a ordem recebida. */
export function ordenarPorRelevancia<T extends { pergunta: string; conteudo: string }>(pergunta: string, fontes: readonly T[], limite: number, doTema: (f: T) => boolean): T[] {
  return fontes
    .map((fonte, ordem) => ({ fonte, ordem, pontos: pontuarConhecimento(pergunta, fonte), tema: doTema(fonte) ? 1 : 0 }))
    .sort((a, b) => b.pontos - a.pontos || b.tema - a.tema || a.ordem - b.ordem)
    .slice(0, limite)
    .map(v => v.fonte);
}

/** Quanto conhecimento segue ao modelo numa chamada. O teto é de caracteres,
 * não de quantidade: respostas curtas de FAQ cabem todas, e o pior caso fica
 * abaixo das antigas 10 fontes de até 4.000 caracteres. */
export const FONTES_PARA_MODELO = { maximo: 25, caracteres: 12000, porFonte: 4000 } as const;

/** Mantém a ordem recebida e para quando a próxima fonte estouraria o teto. */
export function selecionarFontesParaModelo<T extends { conteudo: string }>(fontes: readonly T[], teto: { maximo: number; caracteres: number; porFonte: number } = FONTES_PARA_MODELO): T[] {
  const escolhidas: T[] = [];
  let total = 0;
  for (const fonte of fontes) {
    if (escolhidas.length >= teto.maximo) break;
    if (fonte.conteudo.length > teto.porFonte) continue;
    if (total + fonte.conteudo.length > teto.caracteres) break;
    escolhidas.push(fonte); total += fonte.conteudo.length;
  }
  return escolhidas;
}
