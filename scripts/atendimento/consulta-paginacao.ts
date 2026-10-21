import { cursorHistoricoDaLinha, type CursorHistoricoConsulta } from "./consulta-cursor";

export const LIMITE_BYTES_HISTORICO = 1024 * 1024;
export type LinhaHistoricoPreparada<T> = { registro: T; cursor: CursorHistoricoConsulta };
export type PaginaHistoricoPorBytes<T> = { registros: T[]; mais: boolean; cursor: CursorHistoricoConsulta | null };

export class HistoricoMensagemExcedente extends Error {
  constructor() { super("HISTORICO_MENSAGEM_EXCEDENTE"); this.name = "HistoricoMensagemExcedente"; }
}

function bytesJSON(valor: unknown) {
  try {
    const texto = JSON.stringify(valor);
    if (texto === undefined) throw Error();
    return Buffer.byteLength(texto, "utf8");
  } catch { throw Error("HISTORICO_CONTRATO_INVALIDO"); }
}

/** Entrada desc da consulta SQL, saída cronológica. Nenhum texto ou registro é cortado.
 * O orçamento inclui o JSON inteiro, a pontuação, a flag mais e o cursor realmente entregue. */
export function paginarHistoricoPorBytes<T>(linhas: readonly LinhaHistoricoPreparada<T>[], maisNaOrigem: boolean, limiteBytes = LIMITE_BYTES_HISTORICO): PaginaHistoricoPorBytes<T> {
  if (!Array.isArray(linhas) || linhas.length > 50 || typeof maisNaOrigem !== "boolean" || !Number.isSafeInteger(limiteBytes) || limiteBytes < 1 || limiteBytes > LIMITE_BYTES_HISTORICO || !linhas.length && maisNaOrigem) throw Error("HISTORICO_CONTRATO_INVALIDO");
  const escolhidos: T[] = []; let bytesRegistros = 0, cursor: CursorHistoricoConsulta | null = null;
  for (const linha of linhas) {
    if (!linha || !linha.cursor) throw Error("HISTORICO_CONTRATO_INVALIDO");
    let proximo: CursorHistoricoConsulta;
    try { proximo = cursorHistoricoDaLinha({ id: linha.cursor.id, cursor_antes: linha.cursor.antes }); }
    catch { throw Error("HISTORICO_CONTRATO_INVALIDO"); }
    const quantidade = escolhidos.length + 1, mais = maisNaOrigem || quantidade < linhas.length;
    const acumulado = bytesRegistros + bytesJSON(linha.registro) + (escolhidos.length ? 1 : 0);
    // O array vazio já conta os dois colchetes; acumulado acrescenta registros e vírgulas.
    const total = bytesJSON({ registros: [], mais, cursor: proximo }) + acumulado;
    if (total > limiteBytes) {
      if (!escolhidos.length) throw new HistoricoMensagemExcedente();
      break;
    }
    escolhidos.push(linha.registro); bytesRegistros = acumulado; cursor = proximo;
  }
  const resultado = { registros: escolhidos.reverse(), mais: maisNaOrigem || escolhidos.length < linhas.length, cursor };
  // DTOs são JSON estável. Serializadores customizados/inconsistentes falham sem ultrapassar o teto.
  if (bytesJSON(resultado) > limiteBytes) throw Error("HISTORICO_CONTRATO_INVALIDO");
  return resultado;
}
