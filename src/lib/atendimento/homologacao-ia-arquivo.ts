import "server-only";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ContextoIA, DecisaoIA, LimitesIA, PendenciaApoioIA, RegistroIA, RepositorioIA, TarefaIA, TemaIA } from "./ia-orquestrador";
import { contextoAtualIA } from "./ia-orquestrador";

type Estado = { tipo: "donatella-homologacao-ia-ficticia"; versao: 1; contextos: Record<string, ContextoIA>; trabalhos: Record<string, RegistroIA & { hash: string }> };
const novo = (): Estado => ({ tipo: "donatella-homologacao-ia-ficticia", versao: 1, contextos: {}, trabalhos: {} });
const chaveContexto = (c: Pick<ContextoIA, "empresaId" | "conversaId">) => `${c.empresaId}/${c.conversaId}`;
const hashTarefa = (t: TarefaIA) => createHash("sha256").update(JSON.stringify(t)).digest("hex");
const ficticia = (c: Pick<ContextoIA, "empresaId" | "conversaId" | "clienteId">) => [c.empresaId, c.conversaId, c.clienteId].every(id => /^demo-[A-Za-z0-9_-]{1,80}$/.test(id));
function codigo(erro: unknown) { return erro && typeof erro === "object" && "code" in erro ? erro.code : null; }

/** Repositório LOCAL de ensaio com dados demo-*. Não aceita réplica/HUB/cargas reais.
 * Mutex exclusivo entre instâncias, snapshot fsync + rename, lease/fencing e custo
 * acumulado. Lock órfão bloqueia até revisão; não há roubo automático de lock.
 * A operação produtiva continua exigindo adaptação transacional PostgreSQL. */
export class RepositorioHomologacaoIAArquivo implements RepositorioIA {
  private readonly raiz: string;
  constructor(raiz: string) {
    this.raiz = resolve(raiz);
    if (!/^donatella-ia-ficticia(?:-[A-Za-z0-9_-]+)?$/.test(basename(this.raiz))) throw Error("IA_DIRETORIO_FICTICIO_OBRIGATORIO");
  }
  private async ler(): Promise<Estado> {
    try {
      const texto = await readFile(join(this.raiz, "estado.json"), "utf8");
      if (Buffer.byteLength(texto) > 4 * 1024 * 1024) throw Error("IA_ESTADO_EXCESSIVO");
      const e: Estado = JSON.parse(texto);
      if (e.tipo !== "donatella-homologacao-ia-ficticia" || e.versao !== 1 || !e.contextos || !e.trabalhos || !Object.values(e.contextos).every(ficticia) || !Object.values(e.trabalhos).every(t => ficticia(t.tarefa))) throw Error("IA_ESTADO_NAO_FICTICIO");
      for (const r of Object.values(e.trabalhos)) {
        const d = r.decisao;
        // O formato anterior perdeu o motivo do encaminhamento na falha.
        // Recuperar a continuidade sem inventar esse motivo ou reinferir.
        if (d?.estado === "aguardando_apoio" && d.motivo === "APOIO_INDISPONIVEL" && !d.casoId) {
          if (!Array.isArray(d.fontes)) throw Error("IA_PENDENCIA_LEGADA_INVALIDA");
          r.decisao = { estado: "apoio_pendente", motivo: "MOTIVO_ORIGINAL_NAO_PRESERVADO", motivoOriginalNaoPreservado: true, falha: "APOIO_INDISPONIVEL", fontes: structuredClone(d.fontes), enviosReais: false };
          r.leaseAte = 0;
        }
      }
      return e;
    } catch (e) { if (codigo(e) === "ENOENT") return novo(); throw Error("IA_ESTADO_INVALIDO"); }
  }
  private async transacao<T>(acao: (e: Estado) => T | Promise<T>): Promise<T> {
    await mkdir(this.raiz, { recursive: true, mode: 0o700 });
    const arquivos = await readdir(this.raiz);
    if (!arquivos.includes("estado.json") && arquivos.some(a => a !== "estado.lock" && !a.startsWith("estado-tmp-"))) throw Error("IA_DIRETORIO_OCUPADO");
    const lockPath = join(this.raiz, "estado.lock");
    let lock;
    for (let i = 0; i < 100; i++) {
      try { lock = await open(lockPath, "wx", 0o600); break; }
      catch (e) { if (codigo(e) !== "EEXIST" && !(process.platform === "win32" && ["EACCES", "EPERM"].includes(String(codigo(e))))) throw Error("IA_LOCK_INDISPONIVEL"); await new Promise(r => setTimeout(r, 10)); }
    }
    if (!lock) throw Error("IA_LOCK_OCUPADO_OU_ORFAO");
    let tmp: string | undefined;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, id: randomUUID() })); await lock.sync();
      const estado = await this.ler(), resultado = await acao(estado);
      if (Object.keys(estado.trabalhos).length > 1000 || Object.keys(estado.contextos).length > 1000) throw Error("IA_CAPACIDADE_ENSAIO_EXCEDIDA");
      const texto = JSON.stringify(estado);
      if (Buffer.byteLength(texto) > 4 * 1024 * 1024) throw Error("IA_ESTADO_EXCESSIVO");
      tmp = join(this.raiz, `estado-tmp-${randomUUID()}.json`);
      const arquivo = await open(tmp, "wx", 0o600);
      try { await arquivo.writeFile(texto); await arquivo.sync(); } finally { await arquivo.close(); }
      await rename(tmp, join(this.raiz, "estado.json")); tmp = undefined;
      // Linux: confirmar também a entrada de diretório. Windows não suporta fsync
      // de diretório; a prova de restart não é garantia contra perda de energia.
      if (process.platform !== "win32") { const dir = await open(this.raiz, "r"); try { await dir.sync(); } finally { await dir.close(); } }
      return resultado;
    } finally {
      if (tmp) await unlink(tmp).catch(() => undefined);
      await lock.close(); await unlink(lockPath);
    }
  }
  async definirContexto(c: ContextoIA) {
    if (!ficticia(c) || !Number.isSafeInteger(c.versao) || c.versao < 1 || !["ia", "humano", "encerrada"].includes(c.estado) || !["simulacao", "rascunho", "automatico"].includes(c.modo)) throw Error("IA_CONTEXTO_NAO_FICTICIO");
    await this.transacao(e => { e.contextos[chaveContexto(c)] = structuredClone(c); });
  }
  async iniciarContextos(contextos: ContextoIA[]) {
    if (contextos.some(c => !ficticia(c) || c.modo !== "simulacao" || c.versao !== 1 || c.estado !== "ia")) throw Error("IA_CONTEXTO_NAO_FICTICIO");
    await this.transacao(e => { for (const c of contextos) e.contextos[chaveContexto(c)] ??= structuredClone(c); });
  }
  /** Inbox durable antes do processamento; repetição preserva a versão original. */
  async receberPergunta(p: { id: string; atorId: string; empresaId: string; conversaId: string; pergunta: string; tema: TemaIA }, autorizar: () => Promise<boolean>) {
    if (!/^demo-[A-Za-z0-9_-]{1,80}$/.test(p.id) || p.atorId !== "demo-allan" || typeof p.pergunta !== "string" || !p.pergunta.trim() || p.pergunta.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(p.pergunta) || !["produto", "preco", "estoque", "frete", "agenda", "pedido", "procedimento", "alergia", "excecao"].includes(p.tema)) throw Error("IA_MENSAGEM_INVALIDA");
    return this.transacao(async e => {
      if (!await autorizar()) throw Error("LAB_ACESSO_NEGADO");
      const c = e.contextos[chaveContexto(p)];
      if (!c || !ficticia(c)) throw Error("IA_CONVERSA_AUSENTE");
      const anterior = e.trabalhos[p.id];
      if (anterior) {
        if (anterior.tarefa.pergunta !== p.pergunta || anterior.tarefa.tema !== p.tema || anterior.tarefa.conversaId !== p.conversaId || anterior.tarefa.atorId !== p.atorId || anterior.tarefa.empresaId !== p.empresaId) throw Error("IA_ID_REUTILIZADO");
        return structuredClone(anterior.tarefa);
      }
      c.versao++;
      const tarefa: TarefaIA = { ...p, clienteId: c.clienteId, versao: c.versao, mensagemOrigemId: p.id };
      e.trabalhos[p.id] = { tarefa, hash: hashTarefa(tarefa), lease: "", leaseAte: 0, chamadas: 0, custoReservadoCentavos: 0 };
      return structuredClone(tarefa);
    });
  }
  async alterarContexto(p: { empresaId: string; conversaId: string; versao: number; estado: "ia" | "humano" | "encerrada"; modo: "simulacao" | "rascunho" }, autorizar: () => Promise<boolean>) {
    if (!["ia", "humano", "encerrada"].includes(p.estado) || !["simulacao", "rascunho"].includes(p.modo) || !Number.isSafeInteger(p.versao)) throw Error("IA_CONTEXTO_INVALIDO");
    return this.transacao(async e => {
      if (!await autorizar()) throw Error("LAB_ACESSO_NEGADO");
      const c = e.contextos[chaveContexto(p)];
      if (!c || !ficticia(c)) throw Error("IA_CONVERSA_AUSENTE");
      if (c.versao !== p.versao) throw Error("IA_REVISAO_CONFLITANTE");
      c.versao++; c.estado = p.estado; c.modo = p.modo;
      return structuredClone(c);
    });
  }
  async contextos() { return this.transacao(e => structuredClone(Object.values(e.contextos))); }
  async tarefa(id: string) { return this.transacao(e => structuredClone(e.trabalhos[id] ?? null)); }
  async invalidarObsoleta(t: TarefaIA, autorizar: () => Promise<boolean>) {
    return this.transacao(async e => {
      if (!await autorizar()) throw Error("LAB_ACESSO_NEGADO");
      const r = e.trabalhos[t.id];
      if (r && (!r.decisao || r.decisao.estado === "apoio_pendente") && r.hash === hashTarefa(t) && !contextoAtualIA(t, e.contextos[chaveContexto(t)])) r.decisao = { estado: "invalidado", motivo: "CONTEXTO_OU_ACESSO_INVALIDO", fontes: [], enviosReais: false };
    });
  }
  async contexto(t: TarefaIA) { return this.transacao(e => structuredClone(e.contextos[chaveContexto(t)] ?? null)); }
  async reservar(t: TarefaIA, agora: number, leaseMs: number) {
    if (!ficticia(t)) throw Error("IA_TAREFA_NAO_FICTICIA");
    return this.transacao(e => {
      if (!contextoAtualIA(t, e.contextos[chaveContexto(t)])) return null;
      const existente = e.trabalhos[t.id], hash = hashTarefa(t);
      if (existente && existente.hash !== hash) throw Error("IA_ID_REUTILIZADO");
      if (existente?.decisao && existente.decisao.estado !== "apoio_pendente") return { lease: existente.lease, decisao: structuredClone(existente.decisao) };
      if (existente && existente.leaseAte > agora) return null;
      const lease = randomUUID();
      const pendencia = existente?.decisao ? structuredClone(existente.decisao) : undefined;
      e.trabalhos[t.id] = { tarefa: structuredClone(t), hash, lease, leaseAte: agora + leaseMs, chamadas: existente?.chamadas ?? 0, custoReservadoCentavos: existente?.custoReservadoCentavos ?? 0, ...(pendencia ? { decisao: pendencia } : {}) };
      return { lease, ...(pendencia ? { decisao: pendencia } : {}) };
    });
  }
  async preservarApoio(t: TarefaIA, lease: string, d: PendenciaApoioIA, agora: number) {
    if (!d.motivo || d.motivo.length > 100 || d.fontes.length > 50 || d.casoId || d.texto || d.enviosReais !== false) throw Error("IA_PENDENCIA_INVALIDA");
    return this.transacao(e => {
      const r = e.trabalhos[t.id];
      if (!r || r.lease !== lease || r.leaseAte <= agora || r.hash !== hashTarefa(t) || !contextoAtualIA(t, e.contextos[chaveContexto(t)]) || r.decisao && r.decisao.estado !== "apoio_pendente") return null;
      if (r.decisao?.estado === "apoio_pendente" && (r.decisao.motivo !== d.motivo || JSON.stringify(r.decisao.fontes) !== JSON.stringify(d.fontes))) throw Error("IA_PENDENCIA_REUTILIZADA");
      const persistida: PendenciaApoioIA = { ...structuredClone(d), ...(r.decisao?.estado === "apoio_pendente" && r.decisao.motivoOriginalNaoPreservado ? { motivoOriginalNaoPreservado: true as const } : {}) };
      r.decisao = persistida;
      return structuredClone(persistida);
    });
  }
  async reservarChamada(id: string, lease: string, limites: LimitesIA, agora: number) {
    return this.transacao(e => {
      const r = e.trabalhos[id];
      if (!r || r.lease !== lease || r.leaseAte <= agora || r.decisao || !contextoAtualIA(r.tarefa, e.contextos[chaveContexto(r.tarefa)]) || r.chamadas >= limites.maxChamadas || r.custoReservadoCentavos + limites.custoPorChamadaCentavos > limites.maxCustoCentavos) return false;
      r.chamadas++; r.custoReservadoCentavos += limites.custoPorChamadaCentavos; return true;
    });
  }
  async concluir(t: TarefaIA, lease: string, d: DecisaoIA, agora: number) {
    return this.transacao(e => {
      const r = e.trabalhos[t.id];
      if (!r || r.lease !== lease || r.leaseAte <= agora || r.hash !== hashTarefa(t)) return null;
      if (r.decisao && r.decisao.estado !== "apoio_pendente") return structuredClone(r.decisao);
      if (r.decisao?.estado === "apoio_pendente" && d.estado !== "invalidado" && (d.estado !== "apoio_pendente" && d.estado !== "aguardando_apoio" || d.motivo !== r.decisao.motivo || JSON.stringify(d.fontes) !== JSON.stringify(r.decisao.fontes) || d.estado === "aguardando_apoio" && !d.casoId)) throw Error("IA_PENDENCIA_CONCLUSAO_RECUSADA");
      const final: DecisaoIA = contextoAtualIA(t, e.contextos[chaveContexto(t)]) ? d : { estado: "invalidado", motivo: "CONTEXTO_OU_ACESSO_INVALIDO", fontes: [], enviosReais: false };
      r.decisao = structuredClone(final); if (final.estado === "apoio_pendente") r.leaseAte = 0; return final;
    });
  }
  async registros() { return this.transacao(e => structuredClone(Object.values(e.trabalhos))); }
}
