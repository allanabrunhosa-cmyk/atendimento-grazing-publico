export type RestricaoCampo = "inteiro" | "decimal" | "digitos" | "mascara-numerica";

/** Valida a edição sem converter, arredondar ou extrair números de texto inválido. */
export function aceitaEdicaoCampo(valor: string, regra?: RestricaoCampo, limite = 2000, casas = 18, negativo = true) {
  if (valor.length > limite) return false;
  if (!regra) return true;
  if (regra === "mascara-numerica") return /^[\d.,\s()+\/-]*$/.test(valor);
  if (regra === "digitos") return /^\d*$/.test(valor);
  const sinal = negativo ? "-?" : "";
  return new RegExp(regra === "inteiro" ? `^${sinal}\\d*$` : `^${sinal}\\d*(?:[.,]\\d{0,${casas}})?$`).test(valor);
}

/** Completa apenas o zero inicial de um decimal; não converte nem arredonda. */
export function completarZeroDecimal(valor: string) {
  return valor.replace(/^(-?)([.,])/, (_, sinal: string, separador: string) => `${sinal}0${separador}`);
}
