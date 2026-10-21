import { join } from "node:path";
import { RepositorioHomologacaoIAArquivo } from "../../src/lib/atendimento/homologacao-ia-arquivo";
import { orquestrarIA, type FonteIA, type TarefaIA, type TemaIA } from "../../src/lib/atendimento/ia-orquestrador";
import { ServicoDuvidas, type AtorDuvidas, type PermissaoDuvidas } from "../../src/lib/atendimento/duvidas-aprendizagem";
import { RepositorioDuvidasArquivoFicticio } from "../../src/lib/atendimento/repositorio-duvidas-arquivo-ficticio";

export const EMPRESA_LAB = "demo-grazing";
const ator: AtorDuvidas = { id: "demo-allan", empresaId: EMPRESA_LAB, versaoSessao: 1 };
export const CONTATOS_LAB = [
  { id: "demo-marina", conversaId: "demo-conversa-marina", nome: "Marina • fictícia", canal: "WhatsApp fictício" },
  { id: "demo-rafael", conversaId: "demo-conversa-rafael", nome: "Rafael • fictício", canal: "Instagram fictício" },
];
const permissoes = new Set<PermissaoDuvidas>(["duvidas.visualizar", "duvidas.criar", "duvidas.responder", "duvidas.aprovar_envio", "conhecimento.visualizar", "conhecimento.sugerir", "conhecimento.aprovar"]);
type Revalidar = () => Promise<boolean>;
const limites = { maxChamadas: 3, custoPorChamadaCentavos: 0, maxCustoCentavos: 0, maxDuracaoMs: 3000, timeoutChamadaMs: 1000 };
const fatos: Partial<Record<TemaIA, string>> = {
  produto: "Catálogo fictício: Tábua Celebração e Caixa Presente.",
  preco: "Preço fictício desta consulta: R$ 189,90.",
  estoque: "Estoque fictício consultado: 3 Tábuas Celebração.",
  frete: "Entrega fictícia: orçamento depende do endereço confirmado.",
  agenda: "Agenda fictícia consultada: opção às 15h.",
  pedido: "Pedido fictício deste contato: em preparação.",
};
function conversa(id: string) { if (!CONTATOS_LAB.some(c => c.conversaId === id)) throw Error("LAB_CONVERSA_RECUSADA"); }
async function autorizado(revalidar: Revalidar) { if (!await revalidar()) throw Error("LAB_ACESSO_NEGADO"); }

/** Serviço persistente de homologação demo-*. Não contém receptor externo,
 * credencial de fornecedor, destino de envio ou acesso à réplica real. */
export class ServicoLaboratorio {
  readonly ia: RepositorioHomologacaoIAArquivo;
  readonly duvidas: RepositorioDuvidasArquivoFicticio;
  constructor(raiz: string) {
    this.ia = new RepositorioHomologacaoIAArquivo(join(raiz, "donatella-ia-ficticia"));
    this.duvidas = new RepositorioDuvidasArquivoFicticio(join(raiz, "donatella-duvidas-ficticias"));
  }
  async iniciar() { await this.ia.iniciarContextos(CONTATOS_LAB.map(c => ({ empresaId: EMPRESA_LAB, conversaId: c.conversaId, clienteId: c.id, versao: 1, estado: "ia", modo: "simulacao" }))); }
  private core(revalidar: Revalidar) {
    return new ServicoDuvidas({
      repositorio: this.duvidas,
      autorizar: async (_tx, a, permissao, escopo) => a.id === ator.id && a.empresaId === EMPRESA_LAB && escopo.empresaId === EMPRESA_LAB && !escopo.grupoId && (!escopo.conversaId || CONTATOS_LAB.some(c => c.conversaId === escopo.conversaId)) && (!escopo.clienteId || CONTATOS_LAB.some(c => c.id === escopo.clienteId)) && permissoes.has(permissao) && await revalidar(),
      contextoConversa: async (_tx, empresaId, conversaId) => {
        const c = (await this.ia.contextos()).find(c => c.empresaId === empresaId && c.conversaId === conversaId);
        return c ? { empresaId, conversaId, clienteId: c.clienteId, versao: c.versao, estado: c.estado === "encerrada" ? "encerrada" : "aberta", autoridade: c.estado === "humano" ? "humano" : "ia", janelaClienteAte: new Date(Date.now() + 3600000).toISOString(), revisaoRegras: 1 } : null;
      },
    });
  }
  async estado(revalidar: Revalidar) {
    await autorizado(revalidar);
    const core = this.core(revalidar), contextos = await this.ia.contextos(), trabalhos = await this.ia.registros(), casos = await core.listarCasos(ator);
    const candidatos = await core.listarConhecimentos(ator);
    await autorizado(revalidar);
    return {
      modo: "laboratorio-ficticio", atualizadoEm: new Date().toISOString(), fornecedor: "Simulador local de seleção de fatos", enviosReais: false,
      contatos: CONTATOS_LAB, contextos,
      totais: { trabalhos: trabalhos.length, casos: casos.length, candidatos: candidatos.length }, limiteVisual: 100,
      trabalhos: trabalhos.slice(-100).map(r => ({ id: r.tarefa.id, conversaId: r.tarefa.conversaId, pergunta: r.tarefa.pergunta, tema: r.tarefa.tema, versao: r.tarefa.versao, chamadas: r.chamadas, decisao: r.decisao ?? null })),
      casos: casos.slice(-100), candidatos: candidatos.slice(-100),
    };
  }
  async receber(p: { id: string; conversaId: string; pergunta: string; tema: TemaIA }, revalidar: Revalidar) {
    conversa(p.conversaId);
    const tarefa = await this.ia.receberPergunta({ ...p, atorId: ator.id, empresaId: EMPRESA_LAB }, revalidar);
    return this.processar(tarefa, revalidar);
  }
  async retomar(id: string, revalidar: Revalidar) {
    await autorizado(revalidar);
    const registro = await this.ia.tarefa(id);
    if (!registro) throw Error("LAB_TAREFA_AUSENTE");
    return this.processar(registro.tarefa, revalidar);
  }
  private async conhecimento(t: TarefaIA, revalidar: Revalidar): Promise<FonteIA[]> {
    return (await this.core(revalidar).consultarConhecimento(ator, { empresaId: EMPRESA_LAB, tema: t.tema, clienteId: t.clienteId, conversaId: t.conversaId })).map(f => ({ id: f.id, versao: f.versao, empresaId: EMPRESA_LAB, clienteId: t.clienteId, tema: t.tema, origem: "conhecimento", estado: "aprovado", inicio: 0, fim: Date.parse(f.vigenteAte), conteudo: f.conteudo }));
  }
  private fonteFerramenta(t: TarefaIA): FonteIA[] {
    return fatos[t.tema] ? [{ id: `demo-ferramenta-${t.tema}`, versao: 1, empresaId: EMPRESA_LAB, clienteId: t.clienteId, tema: t.tema, origem: "ferramenta", estado: "aprovado", inicio: 0, fim: Date.now() + 60000, conteudo: fatos[t.tema]! }] : [];
  }
  private async processar(t: TarefaIA, revalidar: Revalidar) {
    const resultado = await orquestrarIA(t, limites, {
      repositorio: this.ia,
      autorizar: async (a, _acao, c) => a === ator.id && c.empresaId === EMPRESA_LAB && await revalidar(),
      conhecimento: tarefa => this.conhecimento(tarefa, revalidar),
      ferramenta: async (_nome, tarefa) => { await autorizado(revalidar); return this.fonteFerramenta(tarefa); },
      provedor: async p => { await autorizado(revalidar); return { selecoes: p.fontes.slice(0, 1).map(f => ({ id: f.id, versao: f.versao })) }; },
      revalidarFontes: async (tarefa, refs) => { await autorizado(revalidar); const fontes = tarefa.tema === "procedimento" ? await this.conhecimento(tarefa, revalidar) : this.fonteFerramenta(tarefa); return refs.every(r => fontes.some(f => f.id === r.id && f.versao === r.versao)); },
      solicitarApoio: async (tarefa, motivo, fontes) => this.core(revalidar).solicitarApoio(ator, {
        empresaId: EMPRESA_LAB, conversaId: tarefa.conversaId, versaoConversa: tarefa.versao, mensagemOrigemId: tarefa.mensagemOrigemId,
        pergunta: tarefa.pergunta, contextoFactual: `Contato fictício. Tema: ${tarefa.tema}. Motivo do apoio: ${motivo}. Modo: simulação/rascunho. Nenhum envio externo.`,
        dadosNecessarios: "Resposta humana revisada para este ensaio fictício.", fontes: fontes.map(f => ({ id: f.id, versao: f.versao })),
        motivo: motivo === "REVISAO_HUMANA_OBRIGATORIA" ? "decisao_humana" : motivo === "FONTES_CONFLITANTES" ? "conflito" : motivo.includes("INDISPONIVEL") ? "ferramenta_indisponivel" : "fonte_insuficiente",
        equipeId: "demo-equipe", prioridade: "normal", exigirRevisao: motivo === "MOTIVO_ORIGINAL_NAO_PRESERVADO", expiraEm: new Date(Date.now() + 86400000).toISOString(),
      }),
    });
    if (resultado.estado === "invalidado") await this.ia.invalidarObsoleta(t, revalidar);
    return resultado;
  }
  async contexto(p: Parameters<RepositorioHomologacaoIAArquivo["alterarContexto"]>[0], revalidar: Revalidar) { conversa(p.conversaId); if (p.empresaId !== EMPRESA_LAB) throw Error("LAB_ESCOPO_RECUSADO"); return this.ia.alterarContexto(p, revalidar); }
  async responder(p: Parameters<ServicoDuvidas["responder"]>[1], revalidar: Revalidar) { return this.core(revalidar).responder(ator, p); }
  async preparar(p: Parameters<ServicoDuvidas["prepararResposta"]>[1], revalidar: Revalidar) { return this.core(revalidar).prepararResposta(ator, p); }
  async sugerir(p: { casoId: string; pergunta: string; resposta: string }, revalidar: Revalidar) {
    await autorizado(revalidar);
    const caso = (await this.core(revalidar).listarCasos(ator)).find(c => c.id === p.casoId);
    const trabalho = (await this.ia.registros()).find(r => r.tarefa.mensagemOrigemId === caso?.mensagemOrigemId);
    if (!caso || trabalho?.tarefa.tema !== "procedimento" || /alerg|intoler|pre[cç]o|estoque|reembol|desconto|estorno/i.test(p.pergunta + " " + p.resposta)) throw Error("LAB_GENERALIZACAO_RECUSADA");
    return this.core(revalidar).sugerirConhecimento(ator, { ...p, categoria: "procedimento", escopo: "oficial", condicoes: "Regra fictícia válida exclusivamente neste laboratório.", vigenteDe: new Date().toISOString(), vigenteAte: new Date(Date.now() + 86400000).toISOString(), conflitos: [], responsavelId: ator.id });
  }
  async revisar(p: Parameters<ServicoDuvidas["revisarConhecimento"]>[1], revalidar: Revalidar) { return this.core(revalidar).revisarConhecimento(ator, p); }
}
