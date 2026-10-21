import 'server-only';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AuditoriaDuvidas, ColecaoDuvidas, DocumentoDuvidas, RepositorioDuvidas, TransacaoDuvidas } from './duvidas-aprendizagem';
type Estado = { tipo: 'donatella-duvidas-ficticias'; versao: 1; documentos: Record<string, DocumentoDuvidas>; revisoes: { colecao: ColecaoDuvidas; documento: DocumentoDuvidas }[]; auditoria: AuditoriaDuvidas[]; epocas: Record<string, number> };
const novo = (): Estado => ({ tipo: 'donatella-duvidas-ficticias', versao: 1, documentos: {}, revisoes: [], auditoria: [], epocas: {} });
const demo = (s: string) => /^demo-[A-Za-z0-9_-]{1,80}$/.test(s);
const codigo = (e: unknown) => e && typeof e === 'object' && 'code' in e ? e.code : null;
/** HOMOLOGAÇÃO FICTÍCIA somente; não armazena dados migrados reais. Snapshot
 * atômico fsync/rename e lock exclusivo entre processos. Lock órfão BLOQUEIA
 * para revisão: não roubar lock nem declarar êxito silenciosamente. */
export class RepositorioDuvidasArquivoFicticio implements RepositorioDuvidas {
  private readonly raiz: string;
  constructor(raiz: string) { this.raiz = resolve(raiz); if (!/^donatella-duvidas-ficticias(?:-[A-Za-z0-9_-]+)?$/.test(basename(this.raiz))) throw Error('DUVIDAS_DIRETORIO_FICTICIO_EXIGIDO'); }
  async transacao<T>(empresaId: string, executar: (tx: TransacaoDuvidas) => Promise<T>): Promise<T> {
    if (!demo(empresaId)) throw Error('DUVIDAS_EMPRESA_FICTICIA_EXIGIDA');
    await mkdir(this.raiz, { recursive: true, mode: 0o700 });
    const arquivos = await readdir(this.raiz);
    if (!arquivos.includes('estado.json') && arquivos.some(a => a !== 'estado.lock' && !a.startsWith('estado-tmp-'))) throw Error('DUVIDAS_DIRETORIO_OCUPADO');
    const lockPath = join(this.raiz, 'estado.lock'); let lock;
    for (let i = 0; i < 100; i++) { try { lock = await open(lockPath, 'wx', 0o600); break; } catch (e) { const c = codigo(e); const transitorio = process.platform === 'win32' && ['EACCES', 'EPERM'].includes(String(c)); if (c !== 'EEXIST' && !transitorio) throw Error('DUVIDAS_LOCK_INDISPONIVEL'); await new Promise(r => setTimeout(r, 10)); } }
    if (!lock) throw Error('DUVIDAS_LOCK_OCUPADO_OU_ORFAO');
    let temporario: string | undefined;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, id: randomUUID() })); await lock.sync();
      let e: Estado;
      try { const s = await readFile(join(this.raiz, 'estado.json'), 'utf8'); if (Buffer.byteLength(s) > 8 * 1024 * 1024) throw Error('DUVIDAS_CAPACIDADE_ENSAIO_EXCEDIDA'); e = JSON.parse(s); if (e.tipo !== 'donatella-duvidas-ficticias' || e.versao !== 1 || !e.documentos || !Array.isArray(e.auditoria) || !Array.isArray(e.revisoes) || !e.epocas || !Object.values(e.documentos).every(d => demo((d as DocumentoDuvidas & { empresaId: string }).empresaId))) throw Error('DUVIDAS_ESTADO_INVALIDO'); }
      catch (err) { if (codigo(err) !== 'ENOENT') throw Error('DUVIDAS_ESTADO_INVALIDO'); e = novo(); }
      const chave = (c: ColecaoDuvidas, id: string) => `${empresaId}:${c}:${id}`;
      const tx: TransacaoDuvidas = {
        async codigoDisponivel(codigo) { return !Object.entries(e.documentos).some(([k, d]) => k.includes(':casos:') && (d as unknown as { codigo?: string }).codigo === codigo); },
        async obter<D extends DocumentoDuvidas>(c: ColecaoDuvidas, id: string): Promise<D | null> { return structuredClone((e.documentos[chave(c, id)] as D | undefined) ?? null); },
        async buscar<D extends DocumentoDuvidas>(c: ColecaoDuvidas, campo: 'codigo' | 'dedupe' | 'fingerprint', valor: string): Promise<D | null> { const r = Object.entries(e.documentos).filter(([k, d]) => k.startsWith(`${empresaId}:${c}:`) && (d as unknown as Record<string, unknown>)[campo] === valor).at(-1); return structuredClone((r?.[1] as D | undefined) ?? null); },
        async listar<D extends DocumentoDuvidas>(c: ColecaoDuvidas) { return structuredClone(Object.entries(e.documentos).filter(([k]) => k.startsWith(`${empresaId}:${c}:`)).map(([, d]) => d as D)); },
        async salvar(c, d) {
          const doc = d as DocumentoDuvidas & { empresaId: string; conversaId?: string; clienteId?: string; revisao?: number };
          if (doc.empresaId !== empresaId || (doc.conversaId && !demo(doc.conversaId))) throw Error('DUVIDAS_ESCOPO_NAO_FICTICIO');
          const anterior = e.documentos[chave(c, doc.id)] as DocumentoDuvidas & { revisao?: number } | undefined;
          if (anterior && (anterior.revisao || 1) >= (doc.revisao || 1)) throw Error('DUVIDAS_REVISAO_CONFLITANTE');
          e.documentos[chave(c, doc.id)] = structuredClone(doc); e.revisoes.push({ colecao: c, documento: structuredClone(doc) });
        },
        async auditar(a) { if (a.empresaId !== empresaId) throw Error('DUVIDAS_ESCOPO_RECUSADO'); e.auditoria.push(structuredClone(a)); },
        async epoca(incrementar = false) { return e.epocas[empresaId] = (e.epocas[empresaId] || 0) + (incrementar ? 1 : 0); },
      };
      const resultado = await executar(tx);
      if (Object.keys(e.documentos).length > 1000 || e.auditoria.length > 10000 || e.revisoes.length > 10000) throw Error('DUVIDAS_CAPACIDADE_ENSAIO_EXCEDIDA');
      const s = JSON.stringify(e); if (Buffer.byteLength(s) > 8 * 1024 * 1024) throw Error('DUVIDAS_CAPACIDADE_ENSAIO_EXCEDIDA');
      temporario = join(this.raiz, `estado-tmp-${randomUUID()}.json`); const arquivo = await open(temporario, 'wx', 0o600);
      try { await arquivo.writeFile(s); await arquivo.sync(); } finally { await arquivo.close(); }
      await rename(temporario, join(this.raiz, 'estado.json')); temporario = undefined;
      if (process.platform !== 'win32') { const dir = await open(this.raiz, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
      return resultado;
    } finally { if (temporario) await unlink(temporario).catch(() => undefined); await lock.close(); await unlink(lockPath); }
  }
}
