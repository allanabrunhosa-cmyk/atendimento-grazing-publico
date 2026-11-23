import type { AuditoriaDuvidas, ColecaoDuvidas, DocumentoDuvidas, RepositorioDuvidas, TransacaoDuvidas } from '../../../src/lib/atendimento/duvidas-aprendizagem';

type Estado = { documentos: Record<string, DocumentoDuvidas>; auditoria: AuditoriaDuvidas[]; epocas: Record<string, number> };

/** Repositório em memória do ambiente fictício local. Segue as regras do
 * repositório em arquivo: escopo da empresa, revisão crescente e transação que
 * só grava quando termina sem erro. Uma transação por vez. */
export class RepositorioDuvidasMemoria implements RepositorioDuvidas {
  private estado: Estado = { documentos: {}, auditoria: [], epocas: {} };
  private fila: Promise<unknown> = Promise.resolve();

  transacao<T>(empresaId: string, executar: (tx: TransacaoDuvidas) => Promise<T>): Promise<T> {
    const rodar = async () => {
      const e = structuredClone(this.estado);
      const chave = (c: ColecaoDuvidas, id: string) => `${empresaId}:${c}:${id}`;
      const daColecao = (c: ColecaoDuvidas) => Object.entries(e.documentos).filter(([k]) => k.startsWith(`${empresaId}:${c}:`)).map(([, d]) => d);
      const tx: TransacaoDuvidas = {
        async codigoDisponivel(codigo) { return !daColecao('casos').some(d => (d as unknown as { codigo?: string }).codigo === codigo); },
        async obter<D extends DocumentoDuvidas>(c: ColecaoDuvidas, id: string): Promise<D | null> { return structuredClone((e.documentos[chave(c, id)] as D | undefined) ?? null); },
        async buscar<D extends DocumentoDuvidas>(c: ColecaoDuvidas, campo: 'codigo' | 'dedupe' | 'fingerprint', valor: string): Promise<D | null> { return structuredClone((daColecao(c).filter(d => (d as unknown as Record<string, unknown>)[campo] === valor).at(-1) as D | undefined) ?? null); },
        async listar<D extends DocumentoDuvidas>(c: ColecaoDuvidas) { return structuredClone(daColecao(c) as D[]); },
        async salvar(c, d) {
          const doc = d as DocumentoDuvidas & { empresaId: string; revisao?: number };
          if (doc.empresaId !== empresaId) throw Error('DUVIDAS_ESCOPO_RECUSADO');
          const anterior = e.documentos[chave(c, doc.id)] as DocumentoDuvidas & { revisao?: number } | undefined;
          if (anterior && (anterior.revisao || 1) >= (doc.revisao || 1)) throw Error('DUVIDAS_REVISAO_CONFLITANTE');
          e.documentos[chave(c, doc.id)] = structuredClone(doc);
        },
        async auditar(a) { if (a.empresaId !== empresaId) throw Error('DUVIDAS_ESCOPO_RECUSADO'); e.auditoria.push(structuredClone(a)); },
        async epoca(incrementar = false) { return e.epocas[empresaId] = (e.epocas[empresaId] || 0) + (incrementar ? 1 : 0); },
      };
      const resultado = await executar(tx);
      this.estado = e;
      return resultado;
    };
    const vez = this.fila.then(rodar, rodar);
    this.fila = vez.catch(() => undefined);
    return vez;
  }
}
