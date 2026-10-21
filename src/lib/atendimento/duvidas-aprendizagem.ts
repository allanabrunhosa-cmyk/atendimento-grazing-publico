import 'server-only';
import { createHash, randomUUID, randomBytes } from 'node:crypto';

/** Transporte independente: nenhuma chamada externa, grant ou promoção de IA.
 * O adapter HUB deve revalidar sessão/permissão e bloquear sua revisão na MESMA
 * transação. Entradas de clientes/grupos são conteúdo; nunca instruções.
 */
export type PermissaoDuvidas = 'duvidas.visualizar' | 'duvidas.criar' | 'duvidas.responder' | 'duvidas.editar' | 'duvidas.aprovar_envio' | 'duvidas.administrar' | 'conhecimento.visualizar' | 'conhecimento.listar' | 'conhecimento.sugerir' | 'conhecimento.aprovar' | 'conhecimento.revogar';
export type AtorDuvidas = { id: string; empresaId: string; versaoSessao: number };
export type FonteConsultada = { id: string; versao: number };
export type PedidoApoio = { empresaId: string; conversaId: string; versaoConversa: number; mensagemOrigemId: string; pergunta: string; contextoFactual: string; dadosNecessarios: string; fontes: FonteConsultada[]; motivo: 'fonte_insuficiente' | 'conflito' | 'ferramenta_indisponivel' | 'excecao_comercial' | 'decisao_humana'; equipeId: string; prioridade: 'normal' | 'alta'; expiraEm: string; grupoId?: string; exigirRevisao?: boolean; perguntasCount?: number };
export type ContextoConversa = { empresaId: string; conversaId: string; clienteId?: string; versao: number; estado: 'aberta' | 'encerrada' | 'cancelada'; autoridade: 'ia' | 'humano'; janelaClienteAte: string; revisaoRegras: number };
export type CasoDuvida = PedidoApoio & { id: string; codigo: string; dedupe: string; revisao: number; criadaEm: string; revisaoRegras: number; estado: 'aguardando' | 'esclarecimento' | 'respondida' | 'revisao' | 'preparada' | 'encerrada' | 'expirada'; responsavelId?: string; resposta?: { texto: string; autorId: string; recebidaEm: string; eventoId: string; revisao: number }; respostaPreparada?: { idempotencia: string; texto: string; revisaoConversa: number; revisaoRegras: number; criadaEm: string }; lembretes: { lembreteEm: string; escalarEm: string; lembretePreparado: boolean; escalacaoPreparada: boolean; confirmacoes?: { lembrete?: string; escalacao?: string } }; envio: { estado: 'nao_enfileirado' | 'enfileirado' | 'aceito' | 'entregue' | 'falhou' | 'incerto'; intencaoId?: string }; motivoRevisao?: string };
export type EventoResposta = { id: string; empresaId: string; dedupe: string; casoId: string; autorId: string; recebidaEm: string; resultado: 'reservada' | 'ja_respondida' | 'tardia' | 'esclarecimento'; hash: string };
export type EscopoConhecimento = 'conversa' | 'cliente' | 'oficial' | 'candidato';
export type CategoriaConhecimento = 'produto' | 'procedimento' | 'politica' | 'preferencia' | 'excecao' | 'comercial_mutavel' | 'seguranca_alimentar';
export type VersaoConhecimento = { versao: number; estado: 'pendente' | 'aprovado' | 'rejeitado' | 'substituido' | 'expirado'; pergunta: string; resposta: string; categoria: CategoriaConhecimento; escopo: EscopoConhecimento; clienteId?: string; conversaId?: string; condicoes: string; vigenteDe: string; vigenteAte: string; autorId: string; criadaEm: string; fonteCasoId: string; aprovadorId?: string; revisadaEm?: string; motivoRevisao?: string; conflitos: string[]; minimizacaoRevisada: boolean; responsavelId: string };
export type CandidatoConhecimento = { id: string; empresaId: string; fingerprint: string; revisao: number; versoes: VersaoConhecimento[] };
export type FonteConhecimento = { id: string; versao: number; pergunta: string; conteudo: string; categoria: CategoriaConhecimento; escopo: EscopoConhecimento; condicoes: string; vigenteAte: string; fonteCasoId: string; responsavelId: string; epoca: number };
export type AuditoriaDuvidas = { id: string; empresaId: string; atorId: string; entidadeId: string; acao: string; revisao: number; em: string; motivo?: string };
export type ColecaoDuvidas = 'casos' | 'respostas' | 'candidatos';
export type DocumentoDuvidas = CasoDuvida | EventoResposta | CandidatoConhecimento;
export interface TransacaoDuvidas {
  /** Somente adapter servidor. Não serializar no DTO/navegador. */
  conexao?: unknown;
  obter<T extends DocumentoDuvidas>(colecao: ColecaoDuvidas, id: string): Promise<T | null>;
  buscar<T extends DocumentoDuvidas>(colecao: ColecaoDuvidas, campo: 'codigo' | 'dedupe' | 'fingerprint', valor: string): Promise<T | null>;
  listar<T extends DocumentoDuvidas>(colecao: ColecaoDuvidas): Promise<T[]>;
  salvar(colecao: ColecaoDuvidas, documento: DocumentoDuvidas): Promise<void>;
  auditar(evento: AuditoriaDuvidas): Promise<void>;
  epoca(incrementar?: boolean): Promise<number>;
  codigoDisponivel(codigo: string): Promise<boolean>;
}
export interface RepositorioDuvidas { transacao<T>(empresaId: string, executar: (tx: TransacaoDuvidas) => Promise<T>): Promise<T> }
export type EscopoAutorizacaoDuvidas = { empresaId: string; conversaId?: string; grupoId?: string; clienteId?: string };
export type DependenciasDuvidas = { repositorio: RepositorioDuvidas; autorizar: (tx: TransacaoDuvidas, ator: AtorDuvidas, permissao: PermissaoDuvidas, escopo: EscopoAutorizacaoDuvidas) => Promise<boolean>; contextoConversa: (tx: TransacaoDuvidas, empresaId: string, conversaId: string) => Promise<ContextoConversa | null>; validarRemetenteGrupo?: (tx: TransacaoDuvidas, ator: AtorDuvidas, evento: RespostaGrupo) => Promise<boolean>; validarIntencaoLembrete?: (tx: TransacaoDuvidas, p: { empresaId: string; casoId: string; tipo: 'lembrete' | 'escalacao'; intencaoId: string; idempotencia: string }) => Promise<boolean>; enfileirarResposta?: (tx: TransacaoDuvidas, ator: AtorDuvidas, caso: CasoDuvida) => Promise<{intencaoId:string}>; agora?: () => Date; gerarCodigo?: () => string };
export type RespostaGrupo = { empresaId: string; provedor: string; contaId: string; grupoId: string; mensagemId: string; remetenteId: string; tipo: 'texto' | 'audio'; texto: string; transcricaoConfiavel?: boolean; propriaDonatella?: boolean; sistema?: boolean; citadoCasoId?: string; correlacaoCitacaoConfiavel?: boolean };
const identificador = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const estadosFinais = ['encerrada', 'expirada'];
const normalizar = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
const hash = (valores: unknown) => createHash('sha256').update(JSON.stringify(valores)).digest('hex');
function falha(codigo: string): never { throw Error(codigo); }
function texto(s: unknown, max: number, vazio = false): asserts s is string { if (typeof s !== 'string' || s.length > max || (!vazio && !s.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) falha('DUVIDAS_ENTRADA_INVALIDA'); }
function id(s: string) { if (!identificador.test(s)) falha('DUVIDAS_ID_INVALIDO'); }
function idMensagem(s: string) { if (typeof s !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@/+=-]{0,511}$/.test(s)) falha('DUVIDAS_MENSAGEM_ID_INVALIDO'); }
function numero(n: number) { if (!Number.isSafeInteger(n) || n < 0) falha('DUVIDAS_VERSAO_INVALIDA'); }
function data(s: string) { if (typeof s !== 'string' || s.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(s) || !Number.isFinite(Date.parse(s))) falha('DUVIDAS_DATA_INVALIDA'); }
function possuiDadosPessoais(s: string) { return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?55\s*)?\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]*\d{4}|\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(s); }
export function extrairCorrelacaoDuvida(s: string): { codigo: string; resposta: string } | null {
  texto(s, 8000, true);
  const encontrados = [...s.matchAll(/#\s*DNT\s*-\s*([A-Z2-9]{6})\b/gi)];
  if (encontrados.length !== 1) return null;
  const encontrado = encontrados[0];
  return { codigo: `#DNT-${encontrado[1].toUpperCase()}`, resposta: s.replace(encontrado[0], '').trim() };
}

export class ServicoDuvidas {
  constructor(private readonly d: DependenciasDuvidas) {}
  private agora() { const a = (this.d.agora || (() => new Date()))(); if (!Number.isFinite(a.getTime())) falha('DUVIDAS_RELOGIO_INVALIDO'); return a.toISOString(); }
  private async autorizado(tx: TransacaoDuvidas, ator: AtorDuvidas, permissao: PermissaoDuvidas, escopo: EscopoAutorizacaoDuvidas) {
    id(ator.id); id(ator.empresaId); id(escopo.empresaId); numero(ator.versaoSessao);
    if (ator.empresaId !== escopo.empresaId || !await this.d.autorizar(tx, ator, permissao, escopo)) falha('DUVIDAS_ACESSO_NEGADO');
  }
  private async auditoria(tx: TransacaoDuvidas, ator: AtorDuvidas, entidadeId: string, acao: string, revisao: number, motivo?: string) { await tx.auditar({ id: randomUUID(), empresaId: ator.empresaId, atorId: ator.id, entidadeId, acao, revisao, em: this.agora(), ...(motivo ? { motivo } : {}) }); }
  private async caso(tx: TransacaoDuvidas, ator: AtorDuvidas, casoId: string, permissao: PermissaoDuvidas) {
    if (!uuid.test(casoId)) falha('DUVIDAS_ID_INVALIDO');
    const c = await tx.obter<CasoDuvida>('casos', casoId); if (!c) falha('DUVIDAS_CASO_AUSENTE');
    await this.autorizado(tx, ator, permissao, { empresaId: c.empresaId, conversaId: c.conversaId, grupoId: c.grupoId }); return c;
  }
  private async contexto(tx: TransacaoDuvidas, c: CasoDuvida) {
    const atual = await this.d.contextoConversa(tx, c.empresaId, c.conversaId);
    if (!atual || atual.empresaId !== c.empresaId || atual.conversaId !== c.conversaId) falha('DUVIDAS_CONTEXTO_AUSENTE'); data(atual.janelaClienteAte); numero(atual.versao); numero(atual.revisaoRegras); return atual;
  }
  async solicitarApoio(ator: AtorDuvidas, p: PedidoApoio): Promise<CasoDuvida> {
    id(p.empresaId); id(p.conversaId); idMensagem(p.mensagemOrigemId); id(p.equipeId); if (p.grupoId) id(p.grupoId);
    numero(p.versaoConversa); texto(p.pergunta, 2000); texto(p.contextoFactual, 3000, true); texto(p.dadosNecessarios, 1500); data(p.expiraEm); p = { ...p, expiraEm: new Date(p.expiraEm).toISOString() };
    if (!['fonte_insuficiente', 'conflito', 'ferramenta_indisponivel', 'excecao_comercial', 'decisao_humana'].includes(p.motivo) || !['normal', 'alta'].includes(p.prioridade) || !Array.isArray(p.fontes) || p.fontes.length > 30 || (p.perguntasCount !== undefined && (!Number.isSafeInteger(p.perguntasCount) || p.perguntasCount < 1 || p.perguntasCount > 20))) falha('DUVIDAS_ENTRADA_INVALIDA');
    p.fontes.forEach(f => { id(f.id); numero(f.versao); });
    const em = this.agora(); if (p.expiraEm <= em || Date.parse(p.expiraEm) - Date.parse(em) > 7 * 86400000) falha('DUVIDAS_EXPIRACAO_INVALIDA');
    return this.d.repositorio.transacao(p.empresaId, async tx => {
      await this.autorizado(tx, ator, 'duvidas.criar', p);
      const atual = await this.d.contextoConversa(tx, p.empresaId, p.conversaId);
      if (!atual || atual.empresaId !== p.empresaId || atual.conversaId !== p.conversaId || atual.versao !== p.versaoConversa || atual.estado !== 'aberta' || atual.autoridade !== 'ia') falha('DUVIDAS_CONTEXTO_ALTERADO');
      numero(atual.versao); numero(atual.revisaoRegras);
      const perguntaNormalizada = normalizar(p.pergunta);
      const dedupe = hash([p.empresaId, p.conversaId, atual.versao, atual.revisaoRegras, perguntaNormalizada]);
      // Retransmissoes equivalentes reutilizam somente o mesmo contexto e regras.
      // O hash anterior e lido sem regravar historia, mas nunca renova um caso
      // criado sob outra versao nem herda sua resposta/aprovacao.
      const hashes = [dedupe, hash([p.empresaId, p.conversaId, perguntaNormalizada])];
      for (const chave of hashes) {
        const existente = await tx.buscar<CasoDuvida>('casos', 'dedupe', chave);
        if (existente && existente.empresaId === p.empresaId && existente.conversaId === p.conversaId && existente.versaoConversa === atual.versao && existente.revisaoRegras === atual.revisaoRegras && normalizar(existente.pergunta) === perguntaNormalizada && !estadosFinais.includes(existente.estado) && existente.expiraEm > em) return existente;
      }
      let codigo = '';
      for (let tentativa = 0; tentativa < 8; tentativa++) { const candidato = this.d.gerarCodigo?.() || '#DNT-' + [...randomBytes(6)].map(n => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join(''); if (!/^#DNT-[A-Z2-9]{6}$/.test(candidato)) falha('DUVIDAS_CODIGO_INVALIDO'); if (await tx.codigoDisponivel(candidato)) { codigo = candidato; break; } }
      if (!codigo) falha('DUVIDAS_COLISAO_CODIGO');
      const c: CasoDuvida = { ...p, id: randomUUID(), codigo, dedupe, revisao: 1, criadaEm: em, revisaoRegras: atual.revisaoRegras, estado: 'aguardando', exigirRevisao: p.exigirRevisao || ['conflito', 'excecao_comercial'].includes(p.motivo), lembretes: { lembreteEm: new Date(Date.parse(em) + 300000).toISOString(), escalarEm: new Date(Date.parse(em) + 900000).toISOString(), lembretePreparado: false, escalacaoPreparada: false }, envio: { estado: 'nao_enfileirado' } };
      await tx.salvar('casos', c); await this.auditoria(tx, ator, c.id, 'caso_criado', c.revisao); return c;
    });
  }
  async listarCasos(ator: AtorDuvidas): Promise<CasoDuvida[]> { return this.d.repositorio.transacao(ator.empresaId, async tx => { await this.autorizado(tx, ator, 'duvidas.visualizar', ator); const todos = await tx.listar<CasoDuvida>('casos'); const visiveis: CasoDuvida[] = []; for (const c of todos) if (await this.d.autorizar(tx, ator, 'duvidas.visualizar', c)) visiveis.push(c); return visiveis; }); }
  /** Revisores autorizados podem comparar candidatos e versões retiradas.
   * Recuperação para a IA usa consultarConhecimento(), nunca esta listagem. */
  async listarConhecimentos(ator: AtorDuvidas): Promise<CandidatoConhecimento[]> {
    return this.d.repositorio.transacao(ator.empresaId, async tx => {
      await this.autorizado(tx, ator, 'conhecimento.listar', ator);
      const visiveis: CandidatoConhecimento[] = [];
      for (const c of await tx.listar<CandidatoConhecimento>('candidatos')) {
        const v = c.versoes.at(-1)!;
        if (await this.d.autorizar(tx, ator, 'conhecimento.listar', { empresaId: c.empresaId, clienteId: v.clienteId, conversaId: v.conversaId })) visiveis.push(c);
      }
      return visiveis;
    });
  }
  /** Retomada da outbox após reinício. IDs estáveis devem ser usados no MESMO
   * diário/fila Chat; preparação de timer não significa notificação enviada. */
  async listarLembretesPendentes(ator: AtorDuvidas) {
    return this.d.repositorio.transacao(ator.empresaId, async tx => {
      await this.autorizado(tx, ator, 'duvidas.administrar', ator);
      const pendentes: { casoId: string; tipo: 'lembrete' | 'escalacao'; idempotencia: string }[] = [];
      for (const c of await tx.listar<CasoDuvida>('casos')) {
        if (!['aguardando', 'esclarecimento'].includes(c.estado) || Date.parse(c.expiraEm) <= Date.parse(this.agora()) || !await this.d.autorizar(tx, ator, 'duvidas.administrar', c)) continue;
        for (const tipo of ['lembrete', 'escalacao'] as const) if ((tipo === 'lembrete' ? c.lembretes.lembretePreparado : c.lembretes.escalacaoPreparada) && !c.lembretes.confirmacoes?.[tipo]) pendentes.push({ casoId: c.id, tipo, idempotencia: hash([c.id, tipo]) });
      }
      return pendentes;
    });
  }
  /** Confirma somente vínculo com intenção durável; não marca entrega externa. */
  async confirmarLembrete(ator: AtorDuvidas, p: { casoId: string; tipo: 'lembrete' | 'escalacao'; intencaoId: string; idempotencia: string }) {
    if (!uuid.test(p.intencaoId) || !['lembrete', 'escalacao'].includes(p.tipo)) falha('DUVIDAS_INTENCAO_INVALIDA');
    return this.d.repositorio.transacao(ator.empresaId, async tx => {
      const c = await this.caso(tx, ator, p.casoId, 'duvidas.administrar');
      const preparado = p.tipo === 'lembrete' ? c.lembretes.lembretePreparado : c.lembretes.escalacaoPreparada;
      if (!preparado || hash([c.id, p.tipo]) !== p.idempotencia) falha('DUVIDAS_LEMBRETE_NAO_PREPARADO');
      if (!this.d.validarIntencaoLembrete || !await this.d.validarIntencaoLembrete(tx, { ...p, empresaId: c.empresaId })) falha('DUVIDAS_INTENCAO_NAO_COMPROVADA');
      const confirmado = c.lembretes.confirmacoes?.[p.tipo];
      if (confirmado) { if (confirmado !== p.intencaoId) falha('DUVIDAS_INTENCAO_CONFLITANTE'); return c; }
      c.lembretes.confirmacoes = { ...c.lembretes.confirmacoes, [p.tipo]: p.intencaoId }; c.revisao++;
      await tx.salvar('casos', c); await this.auditoria(tx, ator, c.id, p.tipo + '_vinculado_intencao', c.revisao); return c;
    });
  }
  async assumir(ator: AtorDuvidas, casoId: string, revisao: number): Promise<CasoDuvida> {
    return this.d.repositorio.transacao(ator.empresaId, async tx => { const c = await this.caso(tx, ator, casoId, 'duvidas.editar'); numero(revisao); if (c.revisao !== revisao || estadosFinais.includes(c.estado)) falha('DUVIDAS_REVISAO_CONFLITANTE'); c.responsavelId = ator.id; c.revisao++; await tx.salvar('casos', c); await this.auditoria(tx, ator, c.id, 'caso_assumido', c.revisao); return c; });
  }
  async responder(ator: AtorDuvidas, p: { casoId: string; revisao: number; mensagemId: string; texto: string }): Promise<{ caso: CasoDuvida; resultado: EventoResposta['resultado'] | 'duplicada' }> {
    texto(p.texto, 4000); idMensagem(p.mensagemId); numero(p.revisao);
    return this.d.repositorio.transacao(ator.empresaId, async tx => { const c = await this.caso(tx, ator, p.casoId, 'duvidas.responder'); return this.reservar(tx, ator, c, p.texto, ['painel', ator.id, p.mensagemId], p.revisao); });
  }
  async receberRespostaGrupo(ator: AtorDuvidas, e: RespostaGrupo): Promise<{ caso: CasoDuvida; resultado: EventoResposta['resultado'] | 'duplicada' } | { resultado: 'ignorada' }> {
    id(e.empresaId); [e.provedor, e.contaId, e.grupoId, e.remetenteId].forEach(id); idMensagem(e.mensagemId); texto(e.texto, 8000, true);
    if (e.propriaDonatella || e.sistema || (e.tipo === 'audio' && !e.transcricaoConfiavel)) return { resultado: 'ignorada' };
    const correlacao = extrairCorrelacaoDuvida(e.texto);
    if (!correlacao && !(e.citadoCasoId && e.correlacaoCitacaoConfiavel)) return { resultado: 'ignorada' };
    return this.d.repositorio.transacao(e.empresaId, async tx => {
      await this.autorizado(tx, ator, 'duvidas.responder', e);
      if (!this.d.validarRemetenteGrupo || !await this.d.validarRemetenteGrupo(tx, ator, e)) falha('DUVIDAS_REMETENTE_NAO_AUTENTICADO');
      const c = correlacao ? await tx.buscar<CasoDuvida>('casos', 'codigo', correlacao.codigo) : await tx.obter<CasoDuvida>('casos', e.citadoCasoId!);
      if (!c || c.empresaId !== e.empresaId || c.grupoId !== e.grupoId) falha('DUVIDAS_CORRELACAO_RECUSADA');
      await this.autorizado(tx, ator, 'duvidas.responder', c);
      return this.reservar(tx, ator, c, correlacao?.resposta || e.texto, [e.provedor, e.contaId, e.grupoId, e.mensagemId], undefined);
    });
  }
  private async reservar(tx: TransacaoDuvidas, ator: AtorDuvidas, c: CasoDuvida, resposta: string, correlacao: string[], revisao?: number) {
    texto(resposta, 4000); const dedupe = hash([c.empresaId, ...correlacao]); const fingerprint = hash([c.id, resposta]); const anterior = await tx.buscar<EventoResposta>('respostas', 'dedupe', dedupe);
    if (anterior) { if (anterior.casoId !== c.id || anterior.hash !== fingerprint) falha('DUVIDAS_MENSAGEM_REUTILIZADA'); return { caso: c, resultado: 'duplicada' as const }; }
    if (revisao !== undefined && c.revisao !== revisao) falha('DUVIDAS_REVISAO_CONFLITANTE');
    const em = this.agora(); const contexto = await this.contexto(tx, c);
    let resultado: EventoResposta['resultado'] = 'reservada';
    if (c.resposta) resultado = 'ja_respondida';
    else if (c.expiraEm <= em || estadosFinais.includes(c.estado) || contexto.versao !== c.versaoConversa || contexto.estado !== 'aberta' || contexto.autoridade !== 'ia' || contexto.revisaoRegras !== c.revisaoRegras) resultado = 'tardia';
    else if ((c.perguntasCount || 1) > 1 && /^(sim|não|nao|pode|ok)[.!]?$/i.test(resposta.trim())) resultado = 'esclarecimento';
    const evento: EventoResposta = { id: randomUUID(), empresaId: c.empresaId, dedupe, casoId: c.id, autorId: ator.id, recebidaEm: em, resultado, hash: fingerprint };
    await tx.salvar('respostas', evento);
    if (resultado === 'reservada' || resultado === 'tardia') { c.resposta = { texto: resposta, autorId: ator.id, recebidaEm: em, eventoId: evento.id, revisao: 1 }; c.estado = resultado === 'tardia' || c.exigirRevisao ? 'revisao' : 'respondida'; if (resultado === 'tardia') c.motivoRevisao = 'contexto_expirado_ou_alterado'; c.revisao++; await tx.salvar('casos', c); }
    if (resultado === 'esclarecimento') { c.estado = 'esclarecimento'; c.revisao++; await tx.salvar('casos', c); }
    await this.auditoria(tx, ator, c.id, 'resposta_' + resultado, c.revisao); return { caso: c, resultado };
  }
  async corrigirResposta(ator: AtorDuvidas, p: { casoId: string; revisao: number; texto: string; motivo: string }) { texto(p.texto, 4000); texto(p.motivo, 500); return this.d.repositorio.transacao(ator.empresaId, async tx => { const c = await this.caso(tx, ator, p.casoId, 'duvidas.editar'); if (c.revisao !== p.revisao || !c.resposta) falha('DUVIDAS_REVISAO_CONFLITANTE'); c.resposta = { ...c.resposta, texto: p.texto, autorId: ator.id, recebidaEm: this.agora(), revisao: c.resposta.revisao + 1 }; c.estado = 'revisao'; c.respostaPreparada = undefined; c.motivoRevisao = 'correcao_humana'; c.revisao++; await tx.salvar('casos', c); await this.auditoria(tx, ator, c.id, 'resposta_corrigida', c.revisao); return c; }); }
  /** Apenas prepara. Worker deve passar pela mesma fila/autoridade Chat e repetir
   * a validação de contexto imediatamente antes do envio. Nunca chama a Meta. */
  async prepararResposta(ator: AtorDuvidas, p: { casoId: string; revisao: number; textoCliente: string; revisaoHumana: boolean }): Promise<CasoDuvida> {
    texto(p.textoCliente, 4000); return this.d.repositorio.transacao(ator.empresaId, async tx => {
      const c = await this.caso(tx, ator, p.casoId, 'duvidas.editar'); if (c.revisao !== p.revisao || !c.resposta || estadosFinais.includes(c.estado) || c.envio.estado !== 'nao_enfileirado') falha('DUVIDAS_PREPARACAO_RECUSADA');
      const atual = await this.contexto(tx, c); const em = this.agora();
      if (c.expiraEm <= em || atual.versao !== c.versaoConversa || atual.estado !== 'aberta' || atual.autoridade !== 'ia' || atual.revisaoRegras !== c.revisaoRegras) falha('DUVIDAS_CONTEXTO_ALTERADO');
      if (Date.parse(atual.janelaClienteAte) <= Date.parse(em)) falha('DUVIDAS_JANELA_CLIENTE_ENCERRADA');
      if ((c.exigirRevisao || c.estado === 'revisao') && !p.revisaoHumana) falha('DUVIDAS_REVISAO_HUMANA_NECESSARIA');
      if (c.exigirRevisao || c.estado === 'revisao') await this.autorizado(tx, ator, 'duvidas.aprovar_envio', c);
      // Sem um contrato de adaptação auditável, preservar a resposta literalmente.
      if (p.textoCliente !== c.resposta.texto) falha('DUVIDAS_ADAPTACAO_NAO_REVISADA');
      c.respostaPreparada = { idempotencia: hash([c.id, c.resposta.revisao, c.versaoConversa]), texto: p.textoCliente, revisaoConversa: atual.versao, revisaoRegras: atual.revisaoRegras, criadaEm: em }; c.estado = 'preparada'; c.revisao++;
      await tx.salvar('casos', c); await this.auditoria(tx, ator, c.id, 'resposta_preparada', c.revisao); return c;
    });
  }
  /** Fila Chat e revisão do caso devem compartilhar a transação. Não chama
   * fornecedor: o worker ainda revalida janela/contexto/autoridade no envio. */
  async enfileirarResposta(ator:AtorDuvidas,p:{casoId:string;revisao:number}):Promise<CasoDuvida> {
    numero(p.revisao);return this.d.repositorio.transacao(ator.empresaId,async tx=>{
      const c=await this.caso(tx,ator,p.casoId,'duvidas.aprovar_envio');
      if(c.envio.estado==='enfileirado'&&c.envio.intencaoId)return c;
      if(c.revisao!==p.revisao||c.estado!=='preparada'||!c.respostaPreparada||c.envio.estado!=='nao_enfileirado'||!this.d.enfileirarResposta)falha('DUVIDAS_PREPARACAO_RECUSADA');
      const atual=await this.contexto(tx,c),em=this.agora();
      if(c.expiraEm<=em||atual.estado!=='aberta'||atual.autoridade!=='ia'||atual.versao!==c.respostaPreparada.revisaoConversa||atual.revisaoRegras!==c.respostaPreparada.revisaoRegras)falha('DUVIDAS_CONTEXTO_ALTERADO');
      if(Date.parse(atual.janelaClienteAte)<=Date.parse(em))falha('DUVIDAS_JANELA_CLIENTE_ENCERRADA');
      const q=await this.d.enfileirarResposta(tx,ator,c);if(!uuid.test(q.intencaoId))falha('DUVIDAS_INTENCAO_NAO_COMPROVADA');
      c.envio={estado:'enfileirado',intencaoId:q.intencaoId};c.revisao++;await tx.salvar('casos',c);await this.auditoria(tx,ator,c.id,'resposta_enfileirada',c.revisao);return c;
    });
  }
  async encerrar(ator: AtorDuvidas, casoId: string, revisao: number) { return this.d.repositorio.transacao(ator.empresaId, async tx => { const c = await this.caso(tx, ator, casoId, 'duvidas.administrar'); if (c.revisao !== revisao) falha('DUVIDAS_REVISAO_CONFLITANTE'); c.estado = 'encerrada'; c.respostaPreparada = undefined; c.revisao++; await tx.salvar('casos', c); await this.auditoria(tx, ator, c.id, 'caso_encerrado', c.revisao); return c; }); }
  /** Outbox lógica de lembretes: no máximo 1 de cada; nenhum disparo externo. */
  async prepararLembretes(ator: AtorDuvidas) { return this.d.repositorio.transacao(ator.empresaId, async tx => { await this.autorizado(tx, ator, 'duvidas.administrar', ator); const em = this.agora(), preparados: { casoId: string; tipo: 'lembrete' | 'escalacao' }[] = []; for (const c of await tx.listar<CasoDuvida>('casos')) { if (!['aguardando', 'esclarecimento'].includes(c.estado) || !await this.d.autorizar(tx, ator, 'duvidas.administrar', c)) continue; if (c.expiraEm <= em) { c.estado = 'expirada'; c.revisao++; await tx.salvar('casos', c); await this.auditoria(tx, ator, c.id, 'caso_expirado', c.revisao); continue; } for (const tipo of ['lembrete', 'escalacao'] as const) { const data = tipo === 'lembrete' ? c.lembretes.lembreteEm : c.lembretes.escalarEm; const preparado = tipo === 'lembrete' ? c.lembretes.lembretePreparado : c.lembretes.escalacaoPreparada; if (data <= em && !preparado) { if (tipo === 'lembrete') c.lembretes.lembretePreparado = true; else c.lembretes.escalacaoPreparada = true; preparados.push({ casoId: c.id, tipo }); await this.auditoria(tx, ator, c.id, tipo + '_preparado', c.revisao); } } c.revisao++; await tx.salvar('casos', c); } return preparados; }); }
  async sugerirConhecimento(ator: AtorDuvidas, p: { casoId: string; pergunta: string; resposta: string; categoria: CategoriaConhecimento; escopo: EscopoConhecimento; clienteId?: string; condicoes: string; vigenteDe: string; vigenteAte: string; conflitos: string[]; responsavelId: string }): Promise<CandidatoConhecimento> {
    texto(p.pergunta, 2000); texto(p.resposta, 6000); texto(p.condicoes, 2000, true); data(p.vigenteDe); data(p.vigenteAte); id(p.responsavelId); if (p.clienteId) id(p.clienteId); if (Date.parse(p.vigenteAte) <= Date.parse(p.vigenteDe) || !Array.isArray(p.conflitos) || p.conflitos.length > 20 || !['produto', 'procedimento', 'politica', 'preferencia', 'excecao', 'comercial_mutavel', 'seguranca_alimentar'].includes(p.categoria) || !['conversa', 'cliente', 'oficial', 'candidato'].includes(p.escopo)) falha('CONHECIMENTO_ENTRADA_INVALIDA'); p.conflitos.forEach(c => texto(c, 500));
    p = { ...p, vigenteDe: new Date(p.vigenteDe).toISOString(), vigenteAte: new Date(p.vigenteAte).toISOString() };
    if (/^(sim|não|nao|ok|certo|confirmado|pode)[.!]?$/i.test(p.resposta.trim())) falha('CONHECIMENTO_CONFIRMACAO_TRIVIAL');
    if (p.escopo === 'oficial' && possuiDadosPessoais(p.pergunta + ' ' + p.resposta + ' ' + p.condicoes)) falha('CONHECIMENTO_DADOS_PESSOAIS');
    if ((p.escopo === 'cliente') !== !!p.clienteId || (p.escopo === 'oficial' && ['preferencia', 'excecao', 'comercial_mutavel'].includes(p.categoria))) falha('CONHECIMENTO_GENERALIZACAO_RECUSADA');
    return this.d.repositorio.transacao(ator.empresaId, async tx => {
      const c = await this.caso(tx, ator, p.casoId, 'conhecimento.sugerir'); if (!c.resposta) falha('CONHECIMENTO_CASO_NAO_RESPONDIDO');
      if (p.clienteId && (await this.contexto(tx, c)).clienteId !== p.clienteId) falha('CONHECIMENTO_CLIENTE_DIVERGENTE');
      await this.autorizado(tx, ator, 'conhecimento.sugerir', { empresaId: c.empresaId, conversaId: c.conversaId, clienteId: p.clienteId });
      const fingerprint = hash([c.empresaId, p.escopo, p.clienteId || null, p.escopo === 'conversa' ? c.conversaId : null, normalizar(p.pergunta), normalizar(p.resposta)]);
      const anterior = await tx.buscar<CandidatoConhecimento>('candidatos', 'fingerprint', fingerprint); if (anterior) return anterior;
      const v: VersaoConhecimento = { ...p, pergunta: normalizar(p.pergunta), versao: 1, estado: 'pendente', autorId: ator.id, criadaEm: this.agora(), fonteCasoId: c.id, minimizacaoRevisada: false, ...(p.escopo === 'conversa' ? { conversaId: c.conversaId } : {}) };
      const candidato = { id: randomUUID(), empresaId: c.empresaId, fingerprint, revisao: 1, versoes: [v] }; await tx.salvar('candidatos', candidato); await this.auditoria(tx, ator, candidato.id, 'conhecimento_sugerido', 1); return candidato;
    });
  }
  async revisarConhecimento(ator: AtorDuvidas, p: { id: string; revisao: number; decisao: 'aprovar' | 'rejeitar'; motivo: string; minimizacaoRevisada: boolean; conflitosResolvidos: boolean }) { texto(p.motivo, 1000); return this.d.repositorio.transacao(ator.empresaId, async tx => { const c = await tx.obter<CandidatoConhecimento>('candidatos', p.id); if (!c) falha('CONHECIMENTO_AUSENTE'); const v = c.versoes.at(-1)!; await this.autorizado(tx, ator, 'conhecimento.aprovar', { empresaId: c.empresaId, clienteId: v.clienteId, conversaId: v.conversaId }); if (c.revisao !== p.revisao || v.estado !== 'pendente' || !['aprovar', 'rejeitar'].includes(p.decisao)) falha('CONHECIMENTO_REVISAO_CONFLITANTE'); if (p.decisao === 'aprovar' && (!p.minimizacaoRevisada || (!p.conflitosResolvidos && v.conflitos.length) || v.vigenteAte <= this.agora() || v.categoria === 'comercial_mutavel' || (v.categoria === 'seguranca_alimentar' && v.escopo !== 'oficial'))) falha('CONHECIMENTO_APROVACAO_RECUSADA'); v.estado = p.decisao === 'aprovar' ? 'aprovado' : 'rejeitado'; v.minimizacaoRevisada = p.minimizacaoRevisada; v.aprovadorId = ator.id; v.revisadaEm = this.agora(); v.motivoRevisao = p.motivo; c.revisao++; await tx.salvar('candidatos', c); await tx.epoca(true); await this.auditoria(tx, ator, c.id, 'conhecimento_' + v.estado, c.revisao); return c; }); }
  async substituirConhecimento(ator: AtorDuvidas, p: { id: string; revisao: number; resposta: string; motivo: string; vigenteAte: string }) { texto(p.resposta, 6000); texto(p.motivo, 1000); data(p.vigenteAte); p = { ...p, vigenteAte: new Date(p.vigenteAte).toISOString() }; return this.d.repositorio.transacao(ator.empresaId, async tx => { const c = await tx.obter<CandidatoConhecimento>('candidatos', p.id); if (!c) falha('CONHECIMENTO_AUSENTE'); const anterior = c.versoes.at(-1)!; await this.autorizado(tx, ator, 'conhecimento.aprovar', { empresaId: c.empresaId, clienteId: anterior.clienteId, conversaId: anterior.conversaId }); if (c.revisao !== p.revisao || p.vigenteAte <= this.agora()) falha('CONHECIMENTO_REVISAO_CONFLITANTE'); if (anterior.escopo === 'oficial' && possuiDadosPessoais(p.resposta)) falha('CONHECIMENTO_DADOS_PESSOAIS'); anterior.estado = 'substituido'; anterior.motivoRevisao = p.motivo; anterior.revisadaEm = this.agora(); c.versoes.push({ ...anterior, versao: anterior.versao + 1, resposta: p.resposta, vigenteDe: this.agora(), vigenteAte: p.vigenteAte, estado: 'pendente', criadaEm: this.agora(), autorId: ator.id, aprovadorId: undefined, revisadaEm: undefined, motivoRevisao: undefined, minimizacaoRevisada: false }); c.revisao++; await tx.salvar('candidatos', c); await tx.epoca(true); await this.auditoria(tx, ator, c.id, 'conhecimento_substituido', c.revisao); return c; }); }
  async revogarConhecimento(ator: AtorDuvidas, p: { id: string; revisao: number; motivo: string }) { texto(p.motivo, 1000); return this.d.repositorio.transacao(ator.empresaId, async tx => { const c = await tx.obter<CandidatoConhecimento>('candidatos', p.id); if (!c) falha('CONHECIMENTO_AUSENTE'); const v = c.versoes.at(-1)!; await this.autorizado(tx, ator, 'conhecimento.revogar', { empresaId: c.empresaId, clienteId: v.clienteId, conversaId: v.conversaId }); if (c.revisao !== p.revisao) falha('CONHECIMENTO_REVISAO_CONFLITANTE'); v.estado = 'expirado'; v.revisadaEm = this.agora(); v.motivoRevisao = p.motivo; c.revisao++; await tx.salvar('candidatos', c); await tx.epoca(true); await this.auditoria(tx, ator, c.id, 'conhecimento_revogado', c.revisao); return c; }); }
  async consultarConhecimento(ator: AtorDuvidas, p: { empresaId: string; tema: string; clienteId?: string; conversaId?: string }): Promise<FonteConhecimento[]> { id(p.empresaId); texto(p.tema, 200); if (p.clienteId) id(p.clienteId); if (p.conversaId) id(p.conversaId); return this.d.repositorio.transacao(p.empresaId, async tx => { await this.autorizado(tx, ator, 'conhecimento.visualizar', p); const em = this.agora(), epoca = await tx.epoca(), fontes: FonteConhecimento[] = []; for (const c of await tx.listar<CandidatoConhecimento>('candidatos')) { const v = c.versoes.at(-1)!; if (v.estado !== 'aprovado' || !v.minimizacaoRevisada || v.vigenteDe > em || v.vigenteAte <= em || v.escopo === 'candidato' || v.categoria === 'comercial_mutavel' || (v.escopo === 'cliente' && v.clienteId !== p.clienteId) || (v.escopo === 'conversa' && v.conversaId !== p.conversaId) || !normalizar(v.pergunta + ' ' + v.resposta + ' ' + v.categoria).includes(normalizar(p.tema))) continue; if (!await this.d.autorizar(tx, ator, 'conhecimento.visualizar', { empresaId: c.empresaId, clienteId: v.clienteId, conversaId: v.conversaId })) continue; fontes.push({ id: c.id, versao: v.versao, pergunta: v.pergunta, conteudo: v.resposta, categoria: v.categoria, escopo: v.escopo, condicoes: v.condicoes, vigenteAte: v.vigenteAte, fonteCasoId: v.fonteCasoId, responsavelId: v.responsavelId, epoca }); } return fontes; }); }
}
