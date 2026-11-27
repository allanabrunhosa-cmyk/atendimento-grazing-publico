/** O pedido é sempre feito pelo cliente no site. A venda só vai para uma pessoa
 * se o pedido é corporativo, se o cliente não consegue pedir pelo site ou quando
 * ele manda os dados de um orçamento que pediu. Preferir o WhatsApp não é um
 * desses casos: a Donatella reforça o site e o link. No pedido corporativo ela
 * primeiro pede os dados do evento; a equipe assume quando o cliente manda. */
export type MotivoVendaEquipe = 'PEDIDO_CORPORATIVO' | 'DIFICULDADE_NO_SITE' | 'ORCAMENTO';
/** Situação da venda nas mensagens anteriores que a equipe ainda não respondeu.
 * `corporativo` marca que os dados aguardados são de um pedido corporativo. */
export type EstadoVenda = { motivo: MotivoVendaEquipe | null; aguardandoOrcamento: boolean; corporativo?: true };
export const VENDA_LIVRE: EstadoVenda = { motivo: null, aguardandoOrcamento: false };

const normalizar = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const LOCAL = '(?:empresas?|firma|escritorio)';
const DONO = '(?:(?:a|o|uma|um|minha|meu|nossa|nosso|essa|esse)\\s+)*';

const CORPORATIVO = [
  /\bcorporativ|\bempresarial\b|\bpessoa juridica\b|\bpj\b|\bcoffee[\s-]*break\b|\batende[mr]?\s+(?:a\s+)?empresas\b/,
  /\b(?:meu|nosso|no|pelo|com|para|pro)\s+cnpj\b/,
  /\b(?:meus|nossos|alguns|uns)\s+clientes\b|\bpresent\w*\s+(?:(?:para|pra|pros|aos|os|varios)\s+)+clientes\b|\bbrindes?\s+(?:para|pra|pros|da|de fim)\b/,
  /\b(?:meus|nossos|dos|aos|pros|para|pra|os|\d{1,4})\s+(?:os\s+)?(?:funcionari|colaborador)/,
  // Ocasião ou gente da empresa: vale mesmo quando a frase fala em enviar.
  new RegExp(`\\b(?:eventos?|festas?|confraternizacao|confraternizacoes|aniversario|reuniao|reunioes|happy hour|(?:fim|final) de ano|almoco|brunch|treinamento|workshop|inauguracao|equipe|time|pessoal|galera|socios)\\s+(?:aqui\\s+)?(?:da|do|de|na|no|pela|pelo|para|pra)\\s+${DONO}${LOCAL}\\b`),
];
const CORPORATIVO_SEM_ENTREGA = [
  new RegExp(`\\b(?:minha|nossa|meu|nosso)\\s+${LOCAL}\\b`),
  new RegExp(`\\b(?:para|pra|pro)\\s+${DONO}${LOCAL}\\b(?!\\s+(?:dela|dele|deles|delas|do|da|de|onde|em que))`),
  /\bsomos\s+(?:uma\s+|de\s+uma\s+|da\s+)?empresa\b|\b(?:falo|sou|falamos|represento)\s+(?:pela|da|a|de uma|uma)\s+empresa\b/,
  new RegExp(`\\b(?:pedido|compra|encomenda|orcamento|cotacao)\\b[^.?!\\n]{0,30}\\b(?:da|pela|pelo|para|pra)\\s+${DONO}${LOCAL}\\b`),
  // Resposta curta à pergunta da ocasião: "é da empresa", "do escritório".
  new RegExp(`^\\W*(?:(?:e|seria|vai ser)\\s+)?(?:da|do|na|no)\\s+${DONO}${LOCAL}\\W*$`),
];
// Presente entregue no trabalho de alguém não é compra da empresa.
const ENTREGA_NO_TRABALHO = new RegExp(`\\b(?:entreg|mand|envi|receb|lev|deix|retir)\\w*\\b[^.?!\\n]{0,40}\\b${LOCAL}\\b`);
const NAO_CORPORATIVO = new RegExp(`\\bnao\\s+(?:e|sou|somos|seria|vai ser|se trata)\\b[^.?!\\n]{0,25}\\b(?:corporativ|${LOCAL}|pj\\b)`);

const NAO_CONSIGO = 'nao\\s+(?:estou\\s+|estamos\\s+|to\\s+|tou\\s+)?(?:consigo|consegui|conseguimos|conseguindo|consiga|conseguir)';
const ETAPA_DO_PEDIDO = '(?:finaliz|conclu|fech(?:ar|o)\\b|pag(?:ar|amento)\\b(?!\\s+(?:isso|tudo|tanto|esse|essa|caro))|compr(?:ar|a|o)\\b|acess|abrir\\b(?!\\s+mao)|entrar\\b(?!\\s+em\\s+contato)|pedir\\b|pedido\\b|fazer\\b(?!\\s+(?:a\\s+|uma\\s+)?(?:escolha|decisao|ideia|conta))|coloc|selecion|agend|marcar\\b|cadastr|logar\\b|efetu|complet|avanc|prossegu|encomend)';
const FALHOU = 'nao\\s+(?:esta\\s+|ta\\s+|estava\\s+|foi\\s+)?(?:abr|funcion|carreg|entra|finaliz|conclu|aceit|deix|avanc|respond|permit|pass|aprov|autoriz|process|gera|gerou|complet|vai\\b|foi\\b)';
const DIFICULDADE = [
  new RegExp(`\\b${NAO_CONSIGO}\\s+(?:\\w+\\s+){0,3}?${ETAPA_DO_PEDIDO}`),
  new RegExp(`\\b${NAO_CONSIGO}\\s+(?:nada\\s+)?(?:pelo|no|por|usar|mexer)\\s+(?:o\\s+|no\\s+)?(?:site|la|esse site|link)\\b`),
  /\bnao\s+(?:esta\s+)?consegue\s+(?:\w+\s+){0,4}?(?:pelo|no)\s+site\b/,
  new RegExp(`\\b(?:site|pagina|link|checkout|carrinho|sistema)\\b[^.?!\\n]{0,40}\\b(?:${FALHOU}|fora do ar|trav(?:ou|ado|ando|a)\\b|caiu\\b|bug|quebrad)`),
  /\b(?:site|pagina|link|checkout|carrinho|sistema)\b[^.?!\n]{0,30}\b(?:da|deu|dando|com|mostra|mostrou|aparece|apareceu)\s+(?:um\s+|uma\s+|algum\s+)?(?:erro|problema|falha|bug)/,
  /(?<!\b(?:sem|nenhum|nenhuma)\s+)(?<!\bnao\s+(?:tem|tenho|tive|ha|teve)\s+(?:nenhum\s+|nenhuma\s+)?)\b(?:erro|problema|falha|bug|dificuldade)s?\b[^.?!\n]{0,30}\b(?:site|pagina|checkout|carrinho|link|pagamento|finaliz\w*|comprar|no pix|no cartao)\b/,
  new RegExp(`\\b(?:pagamento|cartao|pix|compra|cupom)\\b[^.?!\\n]{0,30}\\b(?:recusad|negad|${FALHOU})`),
  /\b(?:deu|da|dando|apareceu|aparece|aparecendo)\s+(?:um\s+)?erro\b/,
  /\bnao\s+sei\s+(?:como\s+)?(?:mexer|usar|comprar|pedir|fazer|finalizar)\b[^.?!\n]{0,30}\b(?:site|internet|online|computador|celular)\b/,
  /\bnao\s+tenho\s+(?:como|acesso)\b[^.?!\n]{0,30}\b(?:site|internet|online|comprar|pedir|fazer o pedido)\b/,
  /\btent(?:ei|amos|ando)\b[^.?!\n]{0,40}\bnao\s+(?:estou\s+|to\s+)?(?:consig|consegu|deu|vai\b|foi\b|funcion|abr|pass|finaliz)/,
  // Resposta curta depois do link: "não consegui", "não deu certo".
  /^\W*(?:(?:oi|ola|olha|poxa|ah|eu|mas|e|ainda|infelizmente|aqui)\W+)*nao\s+(?:estou\s+|to\s+)?(?:consegui|consigo|conseguindo|deu certo|funcionou|funciona|abre|abriu|carrega|carregou)(?:\s+(?:nao|aqui|ainda|fazer|entrar|abrir))?\W*$/,
];

export function motivoVendaEquipe(pergunta: string): MotivoVendaEquipe | null {
  const texto = normalizar(pergunta);
  if (DIFICULDADE.some(r => r.test(texto))) return 'DIFICULDADE_NO_SITE';
  if (NAO_CORPORATIVO.test(texto)) return null;
  if (CORPORATIVO.some(r => r.test(texto))) return 'PEDIDO_CORPORATIVO';
  return !ENTREGA_NO_TRABALHO.test(texto) && CORPORATIVO_SEM_ENTREGA.some(r => r.test(texto)) ? 'PEDIDO_CORPORATIVO' : null;
}

const ORCAMENTO = /\borcamentos?\b|\borcar\b|\bcotacao\b|\bcotacoes\b|\bcotar\b/;
// "Meu orçamento é de R$ 300" é limite de gasto, uma preferência para a busca.
const LIMITE_DE_GASTO = /\b(?:meu|nosso|minha|nossa)\s+orcamento\b|\bno\s+orcamento\b|\bdentro\s+d[oe]\s+(?:um\s+)?orcamento\b|\borcamento\s+(?:e\b|seria|ate\b|maximo|limitado|apertado|curto|baixo|em torno|por volta|gira)|\borcamento\s+de\s+(?:ate\b|uns\s+)?\s*(?:r\$\s*\d|\d[\d.,]*\s*(?:reais|mil\b))/;
const PEDE_ORCAMENTO = /\b(?:quero|queria|gostaria|preciso|precisava|faz|fazem|fazer|manda|mandam|mandar|envia|enviar|passa|passar|pedir|solicitar)\b[^.?!\n]{0,30}\b(?:um\s+|uma\s+)(?:orcamento|cotacao)\b/;
/** Cliente pede um orçamento: a Donatella solicita os dados antes de chamar a equipe. */
export function pedidoOrcamento(pergunta: string): boolean {
  const texto = normalizar(pergunta);
  return ORCAMENTO.test(texto) && (PEDE_ORCAMENTO.test(texto) || !LIMITE_DE_GASTO.test(texto));
}
const CUMPRIMENTO = /^\W*(?:ok|okay|obrigad[oa]|valeu|perfeito|combinado|beleza|tchau|ate mais|ola|oi|bom dia|boa tarde|boa noite)\b/;
/** O cliente está informando algo: nem pergunta, nem só cumprimento ou despedida. */
export function clienteInforma(pergunta: string): boolean {
  return !!pergunta.trim() && !pergunta.includes('?') && !(CUMPRIMENTO.test(normalizar(pergunta)) && pergunta.trim().split(/\s+/).length <= 6);
}
/** Resposta com os dados do orçamento. Quem diz que vai pelo site segue a venda normal. */
export function dadosDeOrcamento(pergunta: string): boolean {
  return clienteInforma(pergunta) && !pedidoOrcamento(pergunta) && !/\bsite\b/.test(normalizar(pergunta));
}
const GRUPO = /\b\d{1,4}\s*(?:pessoas?|convidad[oa]s?|funcionari[oa]s?|colaborador(?:es|as?)?|participantes?|pax)\b/;
const MESES = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const DATA = new RegExp(`\\b\\d{1,2}\\s*[/.-]\\s*\\d{1,2}\\b|\\bdia\\s+\\d{1,2}\\b|\\b\\d{1,2}\\s+de\\s+(?:${MESES})\\b|\\b(?:amanha|depois de amanha|semana que vem|proxima semana|(?:proxima|proximo|nesta|neste|nessa|nesse|essa|este|esse)\\s+(?:segunda|terca|quarta|quinta|sexta|sabado|domingo))\\b`);
/** A mensagem já diz quantas pessoas e quando: a equipe assume sem novo pedido de dados. */
export function dadosCorporativosCompletos(pergunta: string): boolean {
  const texto = normalizar(pergunta);
  return GRUPO.test(texto) && DATA.test(texto);
}
/** Primeiro contato de um pedido corporativo, sem os dados do evento: em vez de
 * passar calada para a equipe, a Donatella pede os dados numa mensagem só. */
export function coletaCorporativa(pergunta: string, venda: EstadoVenda): boolean {
  return motivoVendaEquipe(pergunta) === 'PEDIDO_CORPORATIVO' && !venda.motivo && !venda.aguardandoOrcamento && !dadosCorporativosCompletos(pergunta);
}
/** Fonte fixa da resposta da coleta corporativa. É ela que o modelo usa para
 * redigir o pedido de dados, sem preço, produto ou prazo. */
export const ORIENTACAO_COLETA_CORPORATIVA = {
  id: 'donatella_coleta_corporativa_v1',
  versao: 1,
  titulo: 'Pedido corporativo',
  conteudo: 'Pedido corporativo da Grazing Table & Co: quem prepara o orçamento é a nossa equipe. Para isso, a Donatella agradece o contato e pede ao cliente, numa mensagem só, os dados que ele ainda não informou: nome completo e nome da empresa, número de pessoas, data e horário do evento, bairro e cidade, e o tipo de evento (por exemplo café da manhã, coffee break, almoço ou confraternização). Ela avisa que, com esses dados, a equipe continua o atendimento por aqui. Não sugere produto nem informa preço nesta resposta.',
} as const;
/** Percorre as mensagens do cliente, da mais antiga para a mais nova. */
export function estadoVenda(anteriores: readonly string[]): EstadoVenda {
  return anteriores.reduce<EstadoVenda>((e, p) => {
    if (coletaCorporativa(p, e)) return { motivo: null, aguardandoOrcamento: true, corporativo: true };
    const proprio = motivoVendaEquipe(p);
    if (proprio) return { motivo: proprio, aguardandoOrcamento: false };
    if (e.motivo) return e;
    if (e.aguardandoOrcamento) return dadosDeOrcamento(p) ? { motivo: e.corporativo ? 'PEDIDO_CORPORATIVO' : 'ORCAMENTO', aguardandoOrcamento: false } : e;
    return pedidoOrcamento(p) ? { motivo: null, aguardandoOrcamento: true } : e;
  }, VENDA_LIVRE);
}
