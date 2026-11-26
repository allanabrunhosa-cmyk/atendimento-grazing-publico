import { randomUUID } from 'node:crypto';
import { estadoVenda } from '../../../src/lib/atendimento/encaminhamento-venda';
import { orquestrarIA, type DecisaoIA, type FerramentaIA, type FonteIA, type LimitesIA, type PortasIA, type TarefaIA, type TemaIA } from '../../../src/lib/atendimento/ia-orquestrador';
import { criarProvedorEvidenciasDireto } from '../../../src/lib/atendimento/ia-orquestrador-direto';
import type { ObservacaoConsumoIA } from '../../../src/lib/atendimento/ia-direta';
import { classificarNaConversa, perfilEstiloAgente, skillPermiteAgente, type ConfiguracaoSkillsAgente, type PromptCentralAgente, type TomAgente } from '../../../src/lib/atendimento/repositorio-agente-pg';
import type { EsforcoIA } from '../../../src/lib/atendimento/ia-modelos';

/** Conversa de teste com a IA real, só no ambiente fictício e só com a chave que
 * quem testa informa no próprio computador. Usa o mesmo orquestrador, as mesmas
 * guardas e o mesmo adaptador da operação. Não grava, não envia mensagem e não
 * liga a Donatella. A chave nunca sai em resposta, registro ou erro. */
export type IaFicticia = { chave: string; tetoUsd: number; transporte?: typeof fetch };
export type ModeloConversa = { id: string; nome: string; aviso?: string; entradaUsd: number; saidaUsd: number };
/** Preço por milhão de tokens. O adaptador desliga o pensamento dos modelos novos
 * e manda o esforço salvo na aba Agente & IA, como na operação. */
export const MODELOS_CONVERSA: readonly ModeloConversa[] = [
  { id: 'claude-sonnet-4-5-20250929', nome: 'Sonnet 4.5 (configurado hoje)', aviso: 'A Anthropic desliga este modelo em 30/11/2026.', entradaUsd: 3, saidaUsd: 15 },
  { id: 'claude-sonnet-5-5', nome: 'Sonnet 5.5 (substituto indicado)', entradaUsd: 2, saidaUsd: 10 },
  { id: 'claude-haiku-5-5', nome: 'Haiku 5.5 (mais barato)', entradaUsd: 0.1, saidaUsd: 0.5 },
];
export type RespostaConversa = {
  estado: 'respondeu' | 'equipe' | 'falha'; texto: string; motivo?: string; tema: TemaIA; /** Texto cru da IA quando a resposta foi barrada, só para quem testa entender. */ original?: string;
  fontes: { id: string; titulo: string }[]; modelo: string; custoUsd: number; gastoUsd: number; tetoUsd: number;
};
type Conversa = { tema: TemaIA | null; perguntas: string[]; mensagens: { autor: 'cliente' | 'ia'; texto: string }[]; ocupada: boolean };
type Dependencias = {
  ia?: IaFicticia; catalogoLocal?: boolean; empresaId: string; atorId: string; maxTokens: number; limites: LimitesIA; modeloPadrao: () => string; esforco?: () => EsforcoIA | undefined;
  configuracao: () => { skills: ConfiguracaoSkillsAgente; tom: TomAgente; prompt?: PromptCentralAgente };
  conhecimento: (t: TarefaIA) => Promise<(FonteIA & { titulo: string })[]>;
  ferramenta: (nome: FerramentaIA, t: TarefaIA, mensagensCliente: string[]) => Promise<(FonteIA & { titulo: string })[]>;
};
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_CONVERSAS = 20, MAX_MENSAGENS = 60;
const falha = (codigo: string): never => { throw Error(codigo); };
/** Resposta em português para o motivo que a equipe veria no caso. */
export const MOTIVOS_EQUIPE: Record<string, string> = {
  PEDIDO_CORPORATIVO: 'Pedido corporativo.', DIFICULDADE_NO_SITE: 'O cliente não conseguiu pedir pelo site.', ORCAMENTO: 'O cliente mandou os dados do orçamento.',
  HUMANO_SOLICITADO: 'O cliente pediu um atendente.', REVISAO_HUMANA_OBRIGATORIA: 'Assunto que sempre vai para a equipe.', SEM_FONTE_VIGENTE: 'Faltou informação aprovada sobre isso.',
  PROVEDOR_SOLICITOU_APOIO: 'A própria Donatella pediu ajuda da equipe.', RESPOSTA_REDIGIDA_SEM_FUNDAMENTO: 'A resposta citou número, link ou condição fora das fontes e foi barrada.',
  RESPOSTA_SEM_FUNDAMENTO: 'A resposta não indicou a fonte usada e foi barrada.', FERRAMENTA_OU_LIMITE_INDISPONIVEL: 'O dado dependia de consulta que o teste não faz.', RESPOSTA_TRUNCADA: 'A resposta passou do tamanho permitido.',
  PROVEDOR_OU_LIMITE_INDISPONIVEL: 'A IA respondeu fora do formato exigido e a resposta foi descartada.',
};
function diagnosticoHttp(status: number | null, tipo: string | null): string {
  if (status === 401) return 'A Anthropic recusou a chave (401). Confira se ela foi colada inteira e está ativa.';
  if (status === 403) return 'A chave não tem permissão para este modelo (403).';
  if (status === 404) return 'O modelo não está disponível para esta chave (404).';
  if (status === 429) return 'Limite de uso da conta atingido (429). Espere um pouco e tente de novo.';
  if (status === 400) return `A Anthropic recusou o pedido (400${tipo ? `, ${tipo}` : ''}). Se for conta nova, confira se há crédito em Billing.`;
  if (status !== null && status >= 500) return `A Anthropic está instável (${status}). Tente de novo em alguns minutos.`;
  return 'Não houve resposta da Anthropic. Confira a internet e tente de novo.';
}

export function criarConversaIA(d: Dependencias) {
  const conversas = new Map<string, Conversa>();
  let gastoUsd = 0;
  const estado = () => ({ ligada: !!d.ia, modelos: MODELOS_CONVERSA.map(({ id, nome, aviso }) => ({ id, nome, aviso })), modeloPadrao: MODELOS_CONVERSA.some(m => m.id === d.modeloPadrao()) ? d.modeloPadrao() : MODELOS_CONVERSA[0].id, gastoUsd, tetoUsd: d.ia?.tetoUsd ?? 0, catalogoLocal: d.catalogoLocal === true });
  async function responder(p: { conversaId: unknown; texto: unknown; modelo: unknown }): Promise<RespostaConversa> {
    const ia = d.ia ?? falha('FICTICIO_IA_DESLIGADA');
    if (typeof p.conversaId !== 'string' || !ID.test(p.conversaId) || typeof p.texto !== 'string' || !p.texto.trim() || p.texto.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(p.texto)) falha('OPERACAO_ENTRADA_INVALIDA');
    const modelo = MODELOS_CONVERSA.find(m => m.id === p.modelo) ?? falha('OPERACAO_ENTRADA_INVALIDA'), texto = (p.texto as string).trim(), id = p.conversaId as string;
    // Reserva de uma resposta cara (12 mil tokens de entrada, 512 de saída) antes de gastar.
    const reserva = (12000 * modelo.entradaUsd + 512 * modelo.saidaUsd) / 1e6;
    if (gastoUsd + reserva > ia.tetoUsd) falha('FICTICIO_TETO_IA');
    if (!conversas.has(id) && conversas.size >= MAX_CONVERSAS) conversas.delete(conversas.keys().next().value!);
    const c = conversas.get(id) ?? { tema: null, perguntas: [], mensagens: [], ocupada: false }; conversas.set(id, c);
    if (c.ocupada) falha('FICTICIO_CONVERSA_OCUPADA');
    if (c.mensagens.length >= MAX_MENSAGENS) falha('FICTICIO_CONVERSA_LONGA');
    c.ocupada = true;
    try {
      const { tema, motivoEquipe } = classificarNaConversa(texto, c.tema, estadoVenda(c.perguntas));
      const tarefa: TarefaIA = { id: randomUUID(), atorId: d.atorId, empresaId: d.empresaId, conversaId: 'conversa-teste', clienteId: 'cliente-teste', versao: 1, mensagemOrigemId: 'mensagem-teste', pergunta: texto, tema, ...(motivoEquipe ? { motivoEquipe } : {}) };
      const anteriores = [...c.mensagens], contextoRecente = [...anteriores, { autor: 'cliente' as const, texto }].slice(-20);
      c.tema = tema; c.perguntas.push(texto); c.mensagens.push({ autor: 'cliente', texto });
      let observado: ObservacaoConsumoIA | undefined, status: number | null = null, tipoErro: string | null = null, original = '', chamou = false;
      const base = ia.transporte ?? fetch;
      const transporte: typeof fetch = async (url, opcoes) => {
        chamou = true;
        const r = await base(url, opcoes); status = r.status;
        if (r.ok) original = await r.clone().json().then((v: { content?: { type?: string; text?: string }[]; stop_reason?: string }) => [(v.content ?? []).map(b => b.type === 'text' ? b.text ?? '' : `[bloco ${b.type}]`).join('\n'), v.stop_reason && v.stop_reason !== 'end_turn' ? `[parou por: ${v.stop_reason}]` : ''].filter(Boolean).join('\n').slice(0, 4000), () => '[resposta que não é JSON]');
        else tipoErro = await r.clone().json().then((v: { error?: { type?: unknown } }) => typeof v?.error?.type === 'string' && /^[a-z_]{1,60}$/.test(v.error.type) ? v.error.type : null, () => null);
        return r;
      };
      const { skills, tom, prompt } = d.configuracao(), esforco = d.esforco?.(), titulos = new Map<string, string>(), lidas = new Map<string, FonteIA>();
      const anotar = (fontes: (FonteIA & { titulo: string })[]) => fontes.map(({ titulo, ...f }) => { titulos.set(f.id, titulo); lidas.set(f.id, f); return f; });
      const contexto = { empresaId: tarefa.empresaId, conversaId: tarefa.conversaId, clienteId: tarefa.clienteId, versao: 1, estado: 'ia' as const, modo: 'rascunho' as const };
      const portas: PortasIA = {
        respostaRedigida: true, autorizar: async () => true, contextoRecente: async () => contextoRecente,
        repositorio: { contexto: async () => contexto, reservar: async () => ({ lease: tarefa.id }), reservarChamada: async () => true, preservarApoio: async (_t, _l, v) => v, concluir: async (_t, _l, v) => v },
        conhecimento: async t => skillPermiteAgente(skills, t.tema, 'consultar_conhecimento') ? anotar(await d.conhecimento(t)) : [],
        ferramenta: async (nome, t) => skillPermiteAgente(skills, t.tema, nome) ? anotar(await d.ferramenta(nome, t, anteriores.filter(m => m.autor === 'cliente').map(m => m.texto))) : [],
        revalidarFontes: async (_t, refs) => refs.every(r => lidas.get(r.id)?.versao === r.versao),
        solicitarApoio: async () => ({ id: 'apoio-teste' }),
        provedor: criarProvedorEvidenciasDireto({ provedor: 'anthropic', chave: ia.chave, modelo: modelo.id, maxTokens: d.maxTokens, respostaRedigida: true, estilo: perfilEstiloAgente(tom, skills, tema), promptCentral: prompt?.texto ?? '', ...(esforco ? { esforco } : {}), registrarConsumo: async o => { observado = o; } }, transporte),
      };
      const r = await orquestrarIA(tarefa, d.limites, portas);
      if (r.estado === 'ocupado') return falha('FICTICIO_CONVERSA_OCUPADA');
      const decisao: DecisaoIA = r, consumo = (observado as ObservacaoConsumoIA | undefined)?.consumo;
      // Sem consumo informado depois de chamar, conta a reserva inteira.
      const custoUsd = !chamou ? 0 : consumo?.observado ? ((consumo.tokensEntrada ?? 0) * modelo.entradaUsd + (consumo.tokensSaida ?? 0) * modelo.saidaUsd) / 1e6 : status !== null && status >= 400 && status < 500 ? 0 : reserva;
      gastoUsd += custoUsd;
      const comum = { tema, fontes: decisao.fontes.map(f => ({ id: f.id, titulo: titulos.get(f.id) ?? f.id })), modelo: modelo.id, custoUsd, gastoUsd, tetoUsd: ia.tetoUsd };
      if (decisao.estado === 'rascunho' && decisao.texto) { c.mensagens.push({ autor: 'ia', texto: decisao.texto.slice(0, 2000) }); return { ...comum, estado: 'respondeu', texto: decisao.texto }; }
      const motivo = decisao.motivo ?? 'SEM_MOTIVO';
      if (motivo === 'PROVEDOR_OU_LIMITE_INDISPONIVEL' && (status === null || status >= 400)) return { ...comum, estado: 'falha', texto: diagnosticoHttp(status, tipoErro), motivo };
      return { ...comum, estado: 'equipe', texto: MOTIVOS_EQUIPE[motivo] ?? 'A Donatella chamou a equipe.', motivo, ...(original ? { original } : {}) };
    } finally { c.ocupada = false; }
  }
  return { estado, responder };
}
