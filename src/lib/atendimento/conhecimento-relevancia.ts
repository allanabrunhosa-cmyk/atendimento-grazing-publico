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

/** Ordena por pontuação; empate preserva a ordem recebida. Fontes sem termo em
 * comum entram só quando `manterSemPontos` as aceita, depois das pontuadas. */
export function ordenarPorRelevancia<T extends { pergunta: string; conteudo: string }>(pergunta: string, fontes: readonly T[], limite: number, manterSemPontos: (f: T) => boolean): T[] {
  return fontes
    .map((fonte, ordem) => ({ fonte, ordem, pontos: pontuarConhecimento(pergunta, fonte) }))
    .filter(v => v.pontos > 0 || manterSemPontos(v.fonte))
    .sort((a, b) => b.pontos - a.pontos || a.ordem - b.ordem)
    .slice(0, limite)
    .map(v => v.fonte);
}
