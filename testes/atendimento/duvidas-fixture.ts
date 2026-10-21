import type { AuditoriaDuvidas, ColecaoDuvidas, DocumentoDuvidas, RepositorioDuvidas, TransacaoDuvidas } from '../../src/lib/atendimento/duvidas-aprendizagem';

/** SOMENTE teste fictício. Não é um banco persistente nem adapter operacional. */
export function repositorioDuvidasFicticio() {
  const documentos = new Map<string, DocumentoDuvidas>();
  const auditoria: AuditoriaDuvidas[] = [];
  const epocas = new Map<string, number>();
  let fila = Promise.resolve();
  const repositorio: RepositorioDuvidas = {
    async transacao<T>(empresaId: string, executar: (tx: TransacaoDuvidas) => Promise<T>) {
      let liberar: () => void = () => undefined;
      const anterior = fila; fila = new Promise<void>(resolve => { liberar = resolve; }); await anterior;
      const copia = structuredClone(documentos), copiaAuditoria = structuredClone(auditoria), copiaEpocas = structuredClone(epocas);
      const chave = (colecao: ColecaoDuvidas, id: string) => `${empresaId}:${colecao}:${id}`;
      const tx: TransacaoDuvidas = {
        async codigoDisponivel(codigo) { return ![...documentos.entries()].some(([k, d]) => k.includes(':casos:') && (d as unknown as { codigo?: string }).codigo === codigo); },
        async obter<D extends DocumentoDuvidas>(c: ColecaoDuvidas, id: string): Promise<D | null> { return structuredClone((documentos.get(chave(c, id)) as D | undefined) ?? null); },
        async buscar<D extends DocumentoDuvidas>(c: ColecaoDuvidas, campo: 'codigo' | 'dedupe' | 'fingerprint', valor: string): Promise<D | null> { const encontrados = [...documentos.entries()].filter(([k, d]) => k.startsWith(`${empresaId}:${c}:`) && (d as unknown as Record<string, unknown>)[campo] === valor); return structuredClone((encontrados.at(-1)?.[1] as D | undefined) ?? null); },
        async listar<D extends DocumentoDuvidas>(c: ColecaoDuvidas) { return structuredClone([...documentos.entries()].filter(([k]) => k.startsWith(`${empresaId}:${c}:`)).map(([, d]) => d as D)); },
        async salvar(c, d) { const e = d as DocumentoDuvidas & { empresaId: string; revisao?: number }; if (e.empresaId !== empresaId) throw Error('DUVIDAS_ESCOPO_RECUSADO'); documentos.set(chave(c, d.id), structuredClone(d)); },
        async auditar(e) { auditoria.push(structuredClone(e)); },
        async epoca(incrementar = false) { const valor = (epocas.get(empresaId) || 0) + (incrementar ? 1 : 0); epocas.set(empresaId, valor); return valor; },
      };
      try { return await executar(tx); }
      catch (e) { documentos.clear(); copia.forEach((v, k) => documentos.set(k, v)); auditoria.splice(0, auditoria.length, ...copiaAuditoria); epocas.clear(); copiaEpocas.forEach((v, k) => epocas.set(k, v)); throw e; }
      finally { liberar(); }
    },
  };
  return { repositorio, auditoria, documentos };
}
