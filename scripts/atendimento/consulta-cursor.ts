const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const instante = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/** O Date do driver perde microssegundos; esta coluna textual conserva a chave SQL. */
export const COLUNA_CURSOR_HISTORICO = `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_antes`;

function validarUuid(valor: unknown): asserts valor is string {
  if (typeof valor !== "string" || valor.length !== 36 || !uuid.test(valor)) throw Error("CURSOR_INVALIDO");
}

/** Valida calendário e offset sem converter/reconstruir o instante como Date. */
function validarInstante(valor: unknown): asserts valor is string {
  if (typeof valor !== "string") throw Error("CURSOR_INVALIDO");
  const partes = instante.exec(valor);
  if (!partes || partes[0] !== valor) throw Error("CURSOR_INVALIDO");
  const [ano, mes, dia, hora, minuto, segundo] = partes.slice(1, 7).map(Number);
  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  const dias = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1 || dia > dias[mes - 1] || hora > 23 || minuto > 59 || segundo > 59) throw Error("CURSOR_INVALIDO");
  if (partes[8] !== "Z") {
    const horasOffset = Number(partes[10]), minutosOffset = Number(partes[11]);
    if (horasOffset > 14 || minutosOffset > 59 || horasOffset === 14 && minutosOffset !== 0) throw Error("CURSOR_INVALIDO");
  }
}

export type CursorHistoricoConsulta = { antes: string; id: string };

/** Aceita o ISO de milissegundos já emitido, mantendo ambos os componentes juntos. */
export function validarCursorHistorico(conversa: string, antes: string | null, id: string | null) {
  validarUuid(conversa);
  if (antes === null && id === null) return { conversa, antes: null, id: null };
  validarInstante(antes); validarUuid(id);
  return { conversa, antes, id };
}

/** O cursor novo vem exclusivamente da coluna textual UTC de seis casas do PostgreSQL. */
export function cursorHistoricoDaLinha(linha: { id: unknown; cursor_antes: unknown }): CursorHistoricoConsulta {
  validarUuid(linha.id); validarInstante(linha.cursor_antes);
  if (!/\.\d{6}Z$/.test(linha.cursor_antes)) throw Error("CURSOR_ORIGEM_INVALIDO");
  return { antes: linha.cursor_antes, id: linha.id };
}
