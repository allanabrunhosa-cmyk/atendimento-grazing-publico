/** Negado por padrão até homologação autenticada e liberação de operação. */
export function atendimentoDisponivel() {
  return process.env.ATENDIMENTO_HABILITADO === "true";
}
