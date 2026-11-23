import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ServicoDuvidas, type AtorDuvidas } from '../../../src/lib/atendimento/duvidas-aprendizagem';
import { criarExtensaoAgenteOperacional } from '../../../src/lib/atendimento/operacao-agente-http';
import { validarCondicoesEntrega, type ServicoAgenteOperacional } from '../../../src/lib/atendimento/operacao-agente';
import { SKILLS_AGENTE_PADRAO, TOM_AGENTE_PADRAO, skillPermiteAgente, temaPergunta, validarConfiguracaoAgente, validarSkillsAgente, validarTomAgente, type ConfiguracaoAgente, type ConfiguracaoSkillsAgente, type FerramentaSkillAgente, type TomAgente } from '../../../src/lib/atendimento/repositorio-agente-pg';
import { validarConfiguracaoFollowup, type ConfiguracaoFollowup } from '../../../src/lib/atendimento/operacao-followup';
import { statusErroOperacao } from '../../../src/lib/atendimento/operacao-status-erro';
import type { TemaIA } from '../../../src/lib/atendimento/ia-orquestrador';
import type { IdentidadeOperacao } from '../../../src/lib/atendimento/operacao-tipos';
import { CAPACIDADES_ATENDIMENTO } from '../../../src/lib/permissoes/atendimento';
import { RepositorioDuvidasMemoria } from './repositorio-duvidas-memoria';
import { COLEGA_FICTICIO, EMPRESA_FICTICIA, EQUIPE_FICTICIA, FONTES_FICTICIAS, USUARIO_FICTICIO, conversasFicticias, type ConversaFicticia, type MensagemFicticia } from './dados-ficticios';

/** API do painel para o ambiente fictício local (npm run dev:ficticio).
 * Tudo fica em memória e some ao reiniciar. Não há banco, login do HUB, IA,
 * WhatsApp, WooCommerce nem rede: nenhuma rota abre conexão externa.
 * Conhecimento, dúvidas e condições de entrega usam as mesmas regras e as
 * mesmas rotas HTTP do servidor real. */
export type ApiFicticia = { atender(req: IncomingMessage, res: ServerResponse): Promise<boolean>; encerrar(): void };

const PREFIXO = '/api/atendimento/operacao';
const LIMITE_CORPO = 65536;
const hostLocal = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/;
const origemLocal = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/;
const POR_PAGINA = 30;
/** Mesma escolha de fonte por assunto da Donatella real. */
const FERRAMENTA_POR_TEMA: Partial<Record<TemaIA, FerramentaSkillAgente>> = { produto: 'search_products', preco: 'search_products', estoque: 'search_products', pedido: 'get_order', frete: 'delivery_conditions', agenda: 'available_slots' };
/** Valores que o painel envia no filtro de estado; vazio são as abertas. */
const ESTADOS_FILTRO: Record<string, ConversaFicticia['estado'][]> = { '': ['ia', 'humano', 'pausado'], ia: ['ia'], humano: ['humano'], pausado: ['pausado'], encerrada: ['encerrada'] };
const INDISPONIVEIS = ['/anexos', '/templates/salvar', '/templates/excluir', '/templates/sincronizar', '/contatos/criar', '/contatos/editar', '/contatos/iniciar-conversa', '/mensagens/tentar-novamente'];

const falha = (codigo: string): never => { throw Error(codigo); };
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function enviar(res: ServerResponse, status: number, dados: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(dados)); }
function conferir(atual: number, pedida: unknown) { if (pedida !== atual) falha('OPERACAO_CONFLITO'); }
function texto(v: unknown, max: number, vazio = false): string { if (typeof v !== 'string' || v.length > max || (!vazio && !v.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)) falha('OPERACAO_ENTRADA_INVALIDA'); return v as string; }
function instanteIso(v: unknown) { const s = texto(v, 64); const t = Date.parse(s); if (!Number.isFinite(t)) falha('OPERACAO_ENTRADA_INVALIDA'); return new Date(t).toISOString(); }
async function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] ?? ''))) falha('OPERACAO_JSON_INVALIDO');
  const partes: Buffer[] = []; let total = 0;
  for await (const parte of req) { const b = Buffer.from(parte as Buffer); total += b.length; if (total > LIMITE_CORPO) falha('OPERACAO_CORPO_GRANDE'); partes.push(b); }
  let valor: unknown; try { valor = JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { falha('OPERACAO_JSON_INVALIDO'); }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) falha('OPERACAO_ENTRADA_INVALIDA');
  return valor as Record<string, unknown>;
}

export async function criarApiFicticia(o: { agora?: () => Date } = {}): Promise<ApiFicticia> {
  const agora = o.agora ?? (() => new Date());
  const csrf = randomUUID();
  const identidade: IdentidadeOperacao = { ...USUARIO_FICTICIO, sessaoVersao: 1, permissoes: Object.keys(CAPACIDADES_ATENDIMENTO), tipo: 'usuario' };
  const ator: AtorDuvidas = { id: identidade.id, empresaId: EMPRESA_FICTICIA, versaoSessao: 1 };
  const { conversas, mensagens } = conversasFicticias(agora());
  const sse = new Set<ServerResponse>();
  const avisar = (novaMensagem = false) => { for (const r of sse) r.write(`event: alteracao\ndata: ${JSON.stringify({ novaMensagem })}\n\n`); };
  const conversa = (id: unknown) => conversas.find(c => c.id === id) ?? falha('OPERACAO_CONVERSA_AUSENTE');

  const duvidas = new ServicoDuvidas({
    repositorio: new RepositorioDuvidasMemoria(),
    autorizar: async (_tx, a, _permissao, escopo) => a.empresaId === EMPRESA_FICTICIA && escopo.empresaId === EMPRESA_FICTICIA && [identidade.id, 'donatella'].includes(a.id),
    contextoConversa: async (_tx, empresaId, conversaId) => {
      const c = conversas.find(v => v.id === conversaId);
      if (empresaId !== EMPRESA_FICTICIA || !c) return null;
      return { empresaId, conversaId, clienteId: c.contatoId, versao: c.versao, estado: c.estado === 'encerrada' ? 'encerrada' : 'aberta', autoridade: c.estado === 'ia' ? 'ia' : 'humano', janelaClienteAte: new Date(agora().getTime() + 20 * 3600000).toISOString(), revisaoRegras: 1 };
    },
    // A resposta aprovada de uma dúvida aparece na conversa como envio simulado.
    enfileirarResposta: async (_tx, _a, caso) => {
      const c = conversa(caso.conversaId), intencaoId = randomUUID();
      mensagens.push({ id: 'demo-msg-' + intencaoId, conversaId: c.id, autor: 'ia', autorId: 'donatella', autorNome: 'Donatella', conteudo: caso.respostaPreparada?.texto ?? '', tipo: 'text', estado: 'aceito_simulado', criadaEm: agora().toISOString(), anexoId: null, citadaId: null });
      c.pendentesResposta = 0; queueMicrotask(() => avisar(true));
      return { intencaoId };
    },
    agora,
  });

  // Fontes de exemplo entram pelas mesmas regras do painel.
  const vigenteDe = new Date(agora().getTime() - 86400000).toISOString(), vigenteAte = new Date(agora().getTime() + 365 * 86400000).toISOString();
  for (const f of FONTES_FICTICIAS) {
    const c = await duvidas.cadastrarConhecimento(ator, { pergunta: f.pergunta, resposta: f.resposta, categoria: f.categoria, condicoes: '', vigenteDe, vigenteAte, responsavelId: identidade.id, origem: 'importacao' });
    if (f.aprovada) await duvidas.revisarConhecimento(ator, { id: c.id, revisao: c.revisao, decisao: 'aprovar', motivo: 'Fonte de exemplo do ambiente fictício.', minimizacaoRevisada: true, conflitosResolvidos: true });
  }
  await duvidas.solicitarApoio({ id: 'donatella', empresaId: EMPRESA_FICTICIA, versaoSessao: 1 }, { empresaId: EMPRESA_FICTICIA, conversaId: 'demo-conversa-rafael', versaoConversa: 1, mensagemOrigemId: 'demo-msg-rafael-3', pergunta: 'Vocês fazem versão sem lactose?', contextoFactual: '', dadosNecessarios: 'Confirmar se existe opção sem lactose e como o cliente pede.', fontes: [], motivo: 'fonte_insuficiente', equipeId: EQUIPE_FICTICIA.id, prioridade: 'normal', expiraEm: new Date(agora().getTime() + 2 * 86400000).toISOString() });

  // Configuração da Donatella, com as validações reais.
  let configuracaoAgente: ConfiguracaoAgente = { modo: 'desligado', provedor: 'anthropic', modelo: 'claude-sonnet-4-5-20250929', maxTokens: 512, equipeApoio: EQUIPE_FICTICIA.id, limites: { maxChamadas: 2, custoPorChamadaCentavos: 50, maxCustoCentavos: 100, maxDuracaoMs: 30000, timeoutChamadaMs: 20000 }, custoCentavosDia: 500, moedaOrcamento: 'USD', autoridadeAutomatica: false, grupoExterno: 'indisponivel' };
  validarConfiguracaoAgente(configuracaoAgente);
  let skills: ConfiguracaoSkillsAgente = structuredClone(SKILLS_AGENTE_PADRAO), tom: TomAgente = structuredClone(TOM_AGENTE_PADRAO), followup: ConfiguracaoFollowup = { habilitado: false, minutos: 60, texto: '' }, entrega = { texto: '', aprovada: false };
  let versaoAgente = 1, versaoSkills = 1, versaoTom = 1, versaoFollowup = 1, versaoEntrega = 1;
  const estadoAgente = () => ({ ...configuracaoAgente, provedor: configuracaoAgente.provedor ?? 'anthropic', versao: versaoAgente, moedaOrcamento: 'USD', inferenciaHabilitada: false, credenciais: { anthropic: false, woo: false, voz: false }, enviosReais: false, prontoParaLigar: false, pendencias: ['Ambiente fictício: a Donatella não chama a IA, não consulta o site e não envia mensagens.'], estadoEfetivo: 'desligada', enviosHumanosHabilitados: false, idioma: 'pt-BR', fusoHorario: 'America/Sao_Paulo', horario: null, controle: { habilitada: false, ativadaEm: null }, teste: { disponivel: true, pendencias: [], limiteTotalCentavos: 0, reservadoCentavos: 0 } });

  /** "Testar pergunta" sem IA: mostra o assunto e as fontes que a Donatella
   * receberia, seguindo a mesma escolha de fonte por assunto. */
  async function simularTeste(pergunta: string) {
    const tema = temaPergunta(pergunta), ferramenta = FERRAMENTA_POR_TEMA[tema];
    const base = { provedor: 'anthropic', modelo: 'simulacao-local', versao: versaoAgente, enviosReais: false, reservaCentavos: 0 };
    const aviso = `Simulação local: nenhuma IA foi chamada e nada foi enviado. Assunto identificado: ${tema}.`;
    const apoio = (motivo: string) => ({ ...base, estado: 'apoio', texto: `${aviso} ${motivo} A Donatella pediria apoio à equipe.`, motivo, fontes: [] });
    if (tema === 'alergia' || tema === 'excecao') return apoio('Este assunto é sempre tratado pela equipe.');
    if (!skillPermiteAgente(skills, tema, ferramenta ?? 'consultar_conhecimento') && !(tema === 'produto' && skillPermiteAgente(skills, 'produto', 'consultar_conhecimento'))) return apoio('A habilidade deste assunto está desligada em Habilidades.');
    if (ferramenta === 'delivery_conditions') {
      if (!entrega.aprovada) return apoio('As condições de entrega ainda não foram aprovadas.');
      return { ...base, estado: 'concluido', texto: `${aviso} A Donatella usaria as condições de entrega aprovadas:\n\n${entrega.texto}`, fontes: [{ id: 'condicoes-entrega', versao: versaoEntrega }] };
    }
    if (ferramenta && tema !== 'produto') return apoio(`A resposta depende de consulta ao site (${ferramenta}), que o ambiente fictício não faz.`);
    const fontes = await duvidas.consultarConhecimentoRelevante(ator, { empresaId: EMPRESA_FICTICIA, tema, pergunta, limite: 10 });
    if (!fontes.length) return apoio('Nenhuma fonte aprovada e vigente combina com a pergunta.');
    const lista = fontes.map((f, i) => `${i + 1}. ${f.pergunta.slice(0, 200)} — ${f.conteudo.slice(0, 400)}`).join('\n');
    const produto = tema === 'produto' ? ' Em produção, ela também consultaria o catálogo do site.' : '';
    return { ...base, estado: 'concluido', texto: `${aviso}${produto} Fontes aprovadas que iriam para o modelo, da mais para a menos relevante:\n${lista}`.slice(0, 7900), fontes: fontes.map(f => ({ id: f.id, versao: f.versao })) };
  }

  const agente = {
    duvidas: () => duvidas,
    async estado() { return estadoAgente(); },
    async opcoes() { return { principal: 'anthropic', provedores: [{ id: 'anthropic', nome: 'Anthropic', configurado: false, disponivel: false, testado: false, modelos: [{ id: configuracaoAgente.modelo, nome: configuracaoAgente.modelo, disponivel: false, testado: false }] }] }; },
    async configurar(_i: IdentidadeOperacao, p: { conteudo: ConfiguracaoAgente; versao: number }) {
      conferir(versaoAgente, p.versao); validarConfiguracaoAgente(p.conteudo);
      if ((p.conteudo.modo === 'automatico') !== (configuracaoAgente.modo === 'automatico')) falha('AGENTE_USE_CONTROLE_LIGAR_PAUSAR');
      configuracaoAgente = structuredClone(p.conteudo); return { versao: ++versaoAgente };
    },
    async controlar(_i: IdentidadeOperacao, p: { acao: string; versao: number }) {
      conferir(versaoAgente, p.versao);
      if (p.acao === 'ligar') falha('AGENTE_NAO_PRONTO_PARA_LIGAR');
      if (p.acao !== 'pausar') falha('AGENTE_CONTROLE_INVALIDO');
      return { versao: ++versaoAgente };
    },
    async reconciliar() { return { estado: 'nao_registrada', versao: null }; },
    async testar(_i: IdentidadeOperacao, p: { pergunta: string; versao: number }) { texto(p.pergunta, 2000); conferir(versaoAgente, p.versao); return simularTeste(p.pergunta); },
    async skills() { return { conteudo: structuredClone(skills), versao: versaoSkills, versaoAgente }; },
    async configurarSkills(_i: IdentidadeOperacao, p: { conteudo: ConfiguracaoSkillsAgente; versao: number }) { conferir(versaoSkills, p.versao); validarSkillsAgente(p.conteudo); skills = structuredClone(p.conteudo); return { versao: ++versaoSkills }; },
    async tom() { return { conteudo: structuredClone(tom), versao: versaoTom, versaoAgente }; },
    async configurarTom(_i: IdentidadeOperacao, p: { conteudo: TomAgente; versao: number }) { conferir(versaoTom, p.versao); validarTomAgente(p.conteudo); tom = structuredClone(p.conteudo); return { versao: ++versaoTom }; },
    async followup() { return { configuracao: { ...followup }, versao: versaoFollowup, origem: 'local' }; },
    async configurarFollowup(_i: IdentidadeOperacao, p: { conteudo: ConfiguracaoFollowup; versao: number }) { conferir(versaoFollowup, p.versao); validarConfiguracaoFollowup(p.conteudo); followup = { ...p.conteudo }; return { versao: ++versaoFollowup }; },
    async entrega() { return { versao: versaoEntrega, texto: entrega.texto, aprovada: entrega.aprovada }; },
    async configurarEntrega(_i: IdentidadeOperacao, p: { texto: string; aprovada: boolean; versao: number }) { validarCondicoesEntrega(p); conferir(versaoEntrega, p.versao); entrega = { texto: p.texto.trim(), aprovada: p.aprovada }; return { versao: ++versaoEntrega }; },
  };
  const extensao = criarExtensaoAgenteOperacional(agente as unknown as ServicoAgenteOperacional, EMPRESA_FICTICIA);

  // Demais telas: estado simples em memória.
  let configuracao = { versao: 1, agente: { modo: 'desligado', modelo: configuracaoAgente.modelo }, horarios: { inicio: '08:00', fim: '18:00', dias: [1, 2, 3, 4, 5] }, automacoes: false, enviosReais: false };
  let atalhos: { versao: number; registros: { id: string; nome: string; texto: string }[] } = { versao: 1, registros: [{ id: randomUUID(), nome: 'saudacao', texto: 'Olá! Aqui é da equipe de atendimento. Como posso ajudar?' }] };
  const agenda: Record<string, unknown>[] = [];
  const etapas = [{ id: 'demo-etapa-novo', nome: 'Novo contato' }, { id: 'demo-etapa-orcamento', nome: 'Orçamento enviado' }, { id: 'demo-etapa-fechado', nome: 'Pedido fechado' }];
  const pipeline: Record<string, unknown>[] = [{ id: 'demo-pipeline-rafael', conversaId: 'demo-conversa-rafael', titulo: 'Tábua para 10 pessoas', etapa: 'demo-etapa-orcamento', responsavelId: null, atividade: null, versao: 1, ficticia: true }];
  const envios = new Map<string, { id: string; estado: string }>();

  const lembreteDTO = (l: ConversaFicticia['lembrete']) => { if (!l) return null; const conferidoEm = agora().toISOString(); return { ...l, conferidoEm, atrasado: Date.parse(l.agendadoPara) <= Date.parse(conferidoEm) }; };
  const ultima = (id: string) => mensagens.filter(m => m.conversaId === id && !m.evento).at(-1);
  const conversaDTO = (c: ConversaFicticia) => { const u = ultima(c.id); return { id: c.id, contatoId: c.contatoId, nome: c.nome, telefone: c.telefone, descricao: '', classificacao: c.classificacao, canal: c.canal, estado: c.estado, ultimaMensagem: u?.conteudo?.slice(0, 280) ?? null, ultimaMensagemTipo: u?.tipo ?? null, pendentesResposta: c.pendentesResposta, naoLidas: c.naoLidas, responsavelId: c.responsavelId, equipeId: c.equipeId, tags: c.tags, versao: c.versao, ultimaMensagemEm: u?.criadaEm ?? null, janelaRespostaAberta: c.estado !== 'encerrada', ficticia: true, somenteLeitura: false, lembrete: lembreteDTO(c.lembrete) }; };
  const contatoDTO = (c: ConversaFicticia) => ({ id: c.contatoId, nome: c.nome, telefone: c.telefone, email: null, tags: c.tags, hubClienteId: null, descricao: '', classificacao: c.classificacao, notas: '', versao: 1, conversaId: c.id, canal: c.canal });
  const citacao = (id: string | null) => { const m = id ? mensagens.find(v => v.id === id) : undefined; return m ? { id: m.id, autor: m.autor, autorId: m.autorId, autorNome: m.autorNome, conteudo: m.conteudo?.slice(0, 1600) ?? null, tipo: m.tipo } : null; };
  const mensagemDTO = (m: MensagemFicticia) => ({ ...m, falhaCodigo: null, intencaoId: null, podeTentarNovamente: false, citada: citacao(m.citadaId), podeResponder: !m.evento });
  const recentes = () => [...conversas].sort((a, b) => (ultima(b.id)?.criadaEm ?? '').localeCompare(ultima(a.id)?.criadaEm ?? ''));
  const pagina = (u: URL) => { const n = Number(u.searchParams.get('pagina') ?? 0); if (!Number.isSafeInteger(n) || n < 0) falha('OPERACAO_ENTRADA_INVALIDA'); return n; };

  function listarConversas(u: URL) {
    const n = pagina(u), busca = normalizar(u.searchParams.get('busca') ?? '').trim(), estados = ESTADOS_FILTRO[u.searchParams.get('estado') ?? ''] ?? falha('OPERACAO_ENTRADA_INVALIDA'), canal = u.searchParams.get('canal');
    const filtradas = recentes().filter(c => estados.includes(c.estado) && (!canal || c.canal === canal) && (!busca || normalizar(`${c.nome} ${c.telefone ?? ''} ${ultima(c.id)?.conteudo ?? ''}`).includes(busca)));
    const conta = (e: ConversaFicticia['estado']) => conversas.filter(c => c.estado === e).length;
    const futuros = conversas.map(c => c.lembrete?.agendadoPara).filter((s): s is string => !!s).sort();
    return { registros: filtradas.slice(n * POR_PAGINA, (n + 1) * POR_PAGINA).map(conversaDTO), mais: filtradas.length > (n + 1) * POR_PAGINA, pagina: n, contagens: { total: conta('ia') + conta('humano') + conta('pausado'), ia: conta('ia'), humano: conta('humano'), pausado: conta('pausado'), encerrada: conta('encerrada'), pendentesResposta: conversas.reduce((s, c) => s + c.pendentesResposta, 0), conversasPendentes: conversas.filter(c => c.pendentesResposta > 0).length }, contagensConferidasEm: agora().toISOString(), proximoLembreteEm: futuros[0] ?? null };
  }
  function historico(u: URL) {
    const c = conversa(u.searchParams.get('conversaId')), antes = u.searchParams.get('antes'), antesId = u.searchParams.get('id') ?? '';
    const todas = mensagens.filter(m => m.conversaId === c.id && (!antes || m.criadaEm < antes || m.criadaEm === antes && m.id < antesId)).sort((a, b) => a.criadaEm.localeCompare(b.criadaEm) || a.id.localeCompare(b.id));
    const registros = todas.slice(-50), primeira = registros[0];
    return { conversa: conversaDTO(c), notas: c.notas, proxima: todas.length > registros.length && primeira ? { antes: primeira.criadaEm, id: primeira.id } : null, registros: registros.map(mensagemDTO) };
  }
  function acao(c: ConversaFicticia, p: Record<string, unknown>) {
    conferir(c.versao, p.versao);
    const evento = (tipo: 'encerramento' | 'reabertura') => mensagens.push({ evento: tipo, id: 'demo-evento-' + randomUUID(), conversaId: c.id, autor: 'humano', autorId: identidade.id, autorNome: identidade.nome, conteudo: null, tipo: 'evento', estado: 'registrado', criadaEm: agora().toISOString(), anexoId: null, citadaId: null });
    switch (p.acao) {
      case 'assumir': c.responsavelId = identidade.id; if (c.estado !== 'encerrada') c.estado = 'humano'; break;
      case 'transferir': c.responsavelId = p.responsavelId == null ? null : texto(p.responsavelId, 128); c.equipeId = p.equipeId === undefined ? c.equipeId : p.equipeId === null ? null : texto(p.equipeId, 128); break;
      case 'encerrar': c.estado = 'encerrada'; c.pendentesResposta = 0; evento('encerramento'); break;
      case 'reabrir': c.estado = 'humano'; evento('reabertura'); break;
      case 'nota': c.notas.push({ id: randomUUID(), autorId: identidade.id, texto: texto(p.texto, 8000), criadaEm: agora().toISOString() }); break;
      case 'etiquetas': if (!Array.isArray(p.tags) || p.tags.length > 30) falha('OPERACAO_ENTRADA_INVALIDA'); c.tags = (p.tags as unknown[]).map(t => texto(t, 60)); break;
      case 'pausar': c.estado = 'pausado'; break;
      case 'ia': c.estado = 'ia'; break;
      default: falha('OPERACAO_ENTRADA_INVALIDA');
    }
    return { versao: ++c.versao };
  }
  function enviarMensagem(p: Record<string, unknown>) {
    const chave = texto(p.idempotencia, 128), anterior = envios.get(chave); if (anterior) return anterior;
    if (p.tipo !== 'text') falha('FICTICIO_RECURSO_INDISPONIVEL');
    const c = conversa(p.conversaId); if (c.estado === 'encerrada') falha('OPERACAO_JANELA_FECHADA');
    const citadaId = p.citadaId === undefined ? null : texto(p.citadaId, 128); if (citadaId && !mensagens.some(m => m.id === citadaId && m.conversaId === c.id)) falha('OPERACAO_CITACAO_INDISPONIVEL');
    const m: MensagemFicticia = { id: 'demo-msg-' + randomUUID(), conversaId: c.id, autor: 'humano', autorId: identidade.id, autorNome: identidade.nome, conteudo: texto(p.texto, 4096), tipo: 'text', estado: 'aceito_simulado', criadaEm: agora().toISOString(), anexoId: null, citadaId };
    mensagens.push(m); c.pendentesResposta = 0; c.naoLidas = 0;
    const r = { id: m.id, estado: m.estado }; envios.set(chave, r); return r;
  }
  function lembrete(c: ConversaFicticia, p: Record<string, unknown>) {
    const atual = c.lembrete;
    if (p.acao === 'agendar') { if (atual) falha('OPERACAO_CONFLITO'); c.lembrete = { id: randomUUID(), agendadoPara: instanteIso(p.agendadoPara), descricao: p.descricao === undefined ? '' : texto(p.descricao, 1000, true), versao: 1, criadoPorId: identidade.id, criadoPorNome: identidade.nome }; }
    else {
      if (!atual || p.lembreteId !== atual.id) falha('OPERACAO_CONFLITO'); conferir(atual!.versao, p.versao);
      if (p.acao === 'reagendar' || p.acao === 'atualizar') c.lembrete = { ...atual!, agendadoPara: p.agendadoPara === undefined ? atual!.agendadoPara : instanteIso(p.agendadoPara), descricao: p.descricao === undefined ? atual!.descricao : texto(p.descricao, 1000, true), versao: atual!.versao + 1 };
      else if (p.acao === 'concluir' || p.acao === 'cancelar') c.lembrete = null;
      else falha('OPERACAO_ENTRADA_INVALIDA');
    }
    return { lembrete: lembreteDTO(c.lembrete) };
  }
  function salvarAtalho(p: Record<string, unknown>) {
    conferir(atalhos.versao, p.versao);
    const nome = texto(p.nome, 50), conteudo = texto(p.texto, 4096); if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(nome)) falha('OPERACAO_ENTRADA_INVALIDA');
    if (atalhos.registros.some(a => a.nome === nome && a.id !== p.id)) falha('OPERACAO_ATALHO_NOME_CONFLITO');
    const atalho = { id: p.id === undefined ? randomUUID() : texto(p.id, 36), nome, texto: conteudo };
    if (p.id !== undefined && !atalhos.registros.some(a => a.id === p.id)) falha('OPERACAO_ATALHO_AUSENTE');
    atalhos = { versao: atalhos.versao + 1, registros: [...atalhos.registros.filter(a => a.id !== atalho.id), atalho] };
    return { versao: atalhos.versao, atalho };
  }
  function salvarItem(lista: Record<string, unknown>[], p: Record<string, unknown>) {
    const id = texto(p.id, 128), i = lista.findIndex(v => v.id === id);
    if (i >= 0) conferir(Number(lista[i].versao), p.versao);
    const { idempotencia: _idempotencia, ...dados } = p;
    const item = { ...dados, versao: (i >= 0 ? Number(lista[i].versao) : 0) + 1, ficticia: true };
    if (i >= 0) lista[i] = item; else lista.push(item);
    return { versao: item.versao };
  }

  async function rotas(metodo: string, path: string, u: URL, p: Record<string, unknown> | undefined): Promise<unknown> {
    const corpo = p ?? {};
    if (metodo === 'GET') {
      if (path === '/sessao') return { usuario: { id: identidade.id, nome: identidade.nome, perfilId: identidade.perfilId, permissoes: identidade.permissoes }, csrf, modo: 'homologacao', escritasReais: false };
      if (path === '/status') return { modo: 'homologacao', enviosReais: false, receptor: 'ficticio', fila: { pendentes: 0, incertos: 0, falhas: 0 }, backup: { ultimoSucessoEm: null, falha: 'AMBIENTE_FICTICIO' }, agente: { modo: configuracaoAgente.modo, modelo: configuracaoAgente.modelo, disponivel: false }, woocommerce: null, meta: null, atualizadoEm: agora().toISOString(), importadoEm: null };
      if (path === '/configuracao') return configuracao;
      if (path === '/conversas') return listarConversas(u);
      if (path === '/historico') return historico(u);
      if (path === '/rascunho') return { ...conversa(u.searchParams.get('conversaId')).rascunho };
      if (path === '/contatos') { const n = pagina(u), busca = normalizar(u.searchParams.get('busca') ?? '').trim(), lista = recentes().filter(c => !busca || normalizar(c.nome).includes(busca)); return { registros: lista.slice(n * POR_PAGINA, (n + 1) * POR_PAGINA).map(contatoDTO), mais: lista.length > (n + 1) * POR_PAGINA, pagina: n }; }
      if (path === '/contato') { const c = conversas.find(v => v.contatoId === u.searchParams.get('id')) ?? falha('OPERACAO_CONTATO_AUSENTE'); return { contato: contatoDTO(c) }; }
      if (path === '/equipe') return { usuarios: [{ id: identidade.id, nome: identidade.nome }, COLEGA_FICTICIO], equipes: [EQUIPE_FICTICIA] };
      if (path === '/modelos') return { registros: [] };
      if (path === '/agenda') return { registros: agenda };
      if (path === '/pipeline') return { registros: pipeline, etapas };
      if (path === '/atividades') return { pagina: pagina(u), mais: false, todos: true, usuarios: [{ id: identidade.id, nome: identidade.nome }, COLEGA_FICTICIO], registros: [] };
      if (path === '/atalhos') return atalhos;
      if (path === '/comercial/status') return { estado: 'nao_configurado', ultimoSucessoEm: null, ultimaTentativaEm: null, vinculosPendentes: 0, produtosVinculados: 0, detalhe: 'Ambiente fictício: catálogo e pedidos do site não são consultados.' };
      if (path === '/comercial/produtos') return { produtos: [], consultadoEm: agora().toISOString(), avisos: ['Ambiente fictício: o catálogo do site não é consultado.'], mais: false };
      if (path === '/comercial/pedidos') return { estado: 'indisponivel', pedidos: [], consultadoEm: null, mensagem: 'Ambiente fictício: pedidos do site não são consultados.' };
      if (path === '/mensagens/estado') { const m = mensagens.find(v => v.id === u.searchParams.get('mensagemId') && v.conversaId === u.searchParams.get('conversaId')) ?? falha('OPERACAO_MENSAGEM_AUSENTE'); return { mensagemId: m.id, intencaoId: null, estado: m.estado, falhaCodigo: null, podeTentarNovamente: false }; }
      return undefined;
    }
    const rotaConversa = /^\/conversa\/([^/]+)\/(leitura|abertura|acao|lembrete)$/.exec(path);
    if (metodo === 'POST' && rotaConversa) {
      const c = conversa(decodeURIComponent(rotaConversa[1]));
      if (rotaConversa[2] === 'leitura') { c.naoLidas = 0; return { naoLidas: 0, pendentesResposta: c.pendentesResposta }; }
      if (rotaConversa[2] === 'abertura') return { aberta: true };
      if (rotaConversa[2] === 'acao') return acao(c, corpo);
      return lembrete(c, corpo);
    }
    if (metodo === 'POST' && path === '/mensagens/envio') return enviarMensagem(corpo);
    if (metodo === 'PUT' && path === '/rascunho') { const c = conversa(corpo.conversaId); conferir(c.rascunho.versao, corpo.versao); c.rascunho = { texto: texto(corpo.texto, 4096, true), versao: c.rascunho.versao + 1 }; return { ...c.rascunho }; }
    if (metodo === 'PUT' && path === '/configuracao') { conferir(configuracao.versao, corpo.versao); if (corpo.enviosReais !== false || corpo.automacoes !== false) falha('FICTICIO_ENVIOS_REAIS_INVALIDOS'); const { idempotencia: _idempotencia, ...dados } = corpo; configuracao = { ...(dados as typeof configuracao), versao: configuracao.versao + 1 }; return { versao: configuracao.versao }; }
    if (metodo === 'PUT' && path === '/agenda') return salvarItem(agenda, corpo);
    if (metodo === 'POST' && path === '/pipeline') return salvarItem(pipeline, corpo);
    if (metodo === 'POST' && path === '/atalhos/salvar') return salvarAtalho(corpo);
    if (metodo === 'POST' && path === '/atalhos/excluir') { conferir(atalhos.versao, corpo.versao); if (!atalhos.registros.some(a => a.id === corpo.id)) falha('OPERACAO_ATALHO_AUSENTE'); atalhos = { versao: atalhos.versao + 1, registros: atalhos.registros.filter(a => a.id !== corpo.id) }; return { versao: atalhos.versao, id: corpo.id }; }
    if (INDISPONIVEIS.includes(path)) falha('FICTICIO_RECURSO_INDISPONIVEL');
    return undefined;
  }

  return {
    async atender(req, res) {
      let u: URL; try { u = new URL(req.url ?? '/', 'http://127.0.0.1'); } catch { return false; }
      if (!u.pathname.startsWith(PREFIXO + '/')) return false;
      if (!hostLocal.test(req.headers.host ?? '')) { enviar(res, 421, { erro: 'HOST_RECUSADO' }); return true; }
      const metodo = req.method ?? 'GET', path = u.pathname.slice(PREFIXO.length);
      try {
        if (path === '/eventos' && metodo === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write(': ambiente ficticio\n\n'); sse.add(res);
          const pulso = setInterval(() => res.write(': pulso\n\n'), 25000); pulso.unref();
          req.on('close', () => { clearInterval(pulso); sse.delete(res); });
          return true;
        }
        let p: Record<string, unknown> | undefined;
        if (!['GET', 'HEAD'].includes(metodo)) {
          if (req.headers.origin !== undefined && !origemLocal.test(req.headers.origin) || req.headers['x-csrf-token'] !== csrf) { enviar(res, 403, { erro: 'ORIGEM_RECUSADA' }); return true; }
          if (!['POST', 'PUT'].includes(metodo)) { enviar(res, 405, { erro: 'METODO_RECUSADO' }); return true; }
          p = await lerCorpo(req);
        }
        const resultado = await rotas(metodo, path, u, p);
        if (resultado !== undefined) { enviar(res, 200, resultado); if (p) avisar(path === '/mensagens/envio'); return true; }
        if (await extensao(req, res, identidade, p)) { if (p && res.statusCode === 200) avisar(); return true; }
        enviar(res, metodo === 'GET' ? 404 : 405, { erro: metodo === 'GET' ? 'ROTA_INDISPONIVEL' : 'METODO_RECUSADO' }); return true;
      } catch (e) {
        const codigo = e instanceof Error && /^[A-Z0-9_]{1,80}$/.test(e.message) ? e.message : 'OPERACAO_FALHOU';
        enviar(res, codigo === 'FICTICIO_RECURSO_INDISPONIVEL' ? 400 : statusErroOperacao(codigo), { erro: codigo }); return true;
      }
    },
    encerrar() { for (const r of sse) r.end(); sse.clear(); },
  };
}
