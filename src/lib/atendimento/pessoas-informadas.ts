/** Números de pessoas que o próprio cliente informou. A resposta pode repeti-los
 * ("para 30 pessoas") sem que isso libere outros números fora das fontes. */
const normalizar = (v: string) => v.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const GENTE = '(?:pessoas?|convidad[oa]s?|adult[oa]s?|criancas?|amig[oa]s?)';
const FIM = '(?=\\s*(?:[?!.,:;\\n]|$))';

export function pessoasInformadas(mensagensCliente: readonly string[]): Set<string> {
  const texto = mensagensCliente.map(normalizar).join('\n'), achados = new Set<string>();
  const padroes = [`\\b(\\d{1,3})\\s*(?:a|ou|e|ate|-)\\s*(\\d{1,3})\\s+${GENTE}\\b`, `\\b(\\d{1,3})\\s+${GENTE}\\b`, '\\bsomos\\s+(?:em\\s+)?(\\d{1,3})\\b', `\\bpara\\s+(\\d{1,3})${FIM}`, '\\b(?:grazing|tabua|mesa|grupo)\\s+(?:para|de)\\s+(\\d{1,3})\\b'];
  for (const p of padroes) for (const m of texto.matchAll(new RegExp(p, 'g'))) for (const n of m.slice(1)) if (n && Number(n) > 0) achados.add(n);
  return achados;
}
// Dizer que algo serve, rende ou é "para 30 pessoas" é capacidade do produto: só
// vale com fonte, mesmo que o cliente tenha dito 30.
const CAPACIDADE = /\b(?:serv\w*|rend\w*|atend\w*|aliment\w*|comport\w*|suficient\w*|ideal|ideais|porc\w*|satisf\w*|cobr\w*)\b[^.?!\n]{0,40}$|\b(?:grazing|tabua|mesa|caixa|cesta|kit|combo|box|torta)\s+(?:\w+\s+){0,2}para\s+(?:ate\s+)?$|\bdao?\s+para\s+(?:\w+\s+){0,2}$/;
/** Tira do texto já normalizado só as menções a essa quantidade de pessoas.
 * Também vale o número sozinho logo depois de um verbo de grupo ("vão receber 30,",
 * "vocês serão 30."), desde que a frase acabe nele. */
export function semPessoasInformadas(textoNormalizado: string, pessoas: ReadonlySet<string>): string {
  if (!pessoas.size) return textoNormalizado;
  return textoNormalizado
    .replace(new RegExp(`\\b(\\d{1,3})(?:\\s*(?:a|ou|e|ate|-)\\s*(\\d{1,3}))?(\\s+${GENTE})\\b`, 'g'), (m, a: string, b: string | undefined, gente: string, posicao: number, todo: string) => pessoas.has(a) && (!b || pessoas.has(b)) && !CAPACIDADE.test(todo.slice(Math.max(0, posicao - 60), posicao)) ? gente : m)
    .replace(new RegExp(`\\b(para|grupo de|festa de|receber|recebe|recebendo|reunir|reunindo|serao|seremos|sao|somos)\\s+((?:os|as|seus|suas)\\s+)?(\\d{1,3})${FIM}`, 'g'), (m, antes: string, _meio, n: string, posicao: number, todo: string) => pessoas.has(n) && !CAPACIDADE.test(todo.slice(Math.max(0, posicao - 60), posicao) + antes + ' ') ? antes : m);
}
