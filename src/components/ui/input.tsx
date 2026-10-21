"use client"

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"
import { aceitaEdicaoCampo, completarZeroDecimal, type RestricaoCampo } from "@/lib/campos-entrada"

type InputProps = React.ComponentProps<"input"> & { restricao?: RestricaoCampo; casasDecimais?: number };

function Input({ className, type, restricao, casasDecimais = 18, maxLength, onChange, onKeyDown, onPaste, ...props }: InputProps) {
  const numerico = type === "number" || type === "tel" || props.inputMode === "numeric" || props.inputMode === "decimal" || !!restricao;
  const regra = restricao ?? (type === "number" ? props.step == null || Number(props.step) === 1 ? "inteiro" : "decimal" : props.inputMode === "decimal" ? "decimal" : props.inputMode === "numeric" || type === "tel" ? "mascara-numerica" : undefined);
  const limite = maxLength ?? (numerico ? 40 : type === "email" ? 254 : type === "tel" ? 40 : type === "url" ? 2048 : type === "password" ? 256 : 2000);
  const negativo = props.min == null || Number(props.min) < 0;
  const ultimo = React.useRef(String(props.value ?? props.defaultValue ?? ""));
  const valido = (s: string) => aceitaEdicaoCampo(s, regra, limite, casasDecimais, negativo);
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[var(--ds-controle-altura)] w-full min-w-0 rounded-[var(--ds-controle-raio)] border border-input bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors duration-[var(--ds-movimento-rapido)] outline-none placeholder-shown:font-normal file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
      maxLength={limite}
      onChange={e => {
        const bruto = e.target.value;
        const normalizado = regra === "decimal" ? completarZeroDecimal(bruto) : bruto;
        if (!valido(normalizado)) { e.target.value = String(props.value ?? ultimo.current); return; }
        if (normalizado !== bruto) {
          const inicio = e.target.selectionStart, fim = e.target.selectionEnd;
          e.target.value = normalizado;
          if (inicio !== null && fim !== null) e.target.setSelectionRange(inicio + 1, fim + 1);
        }
        ultimo.current = e.target.value;
        onChange?.(e);
      }}
      onKeyDown={e => {
        onKeyDown?.(e);
        if (!e.defaultPrevented && regra && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && !valido(e.key)) e.preventDefault();
      }}
      onPaste={e => {
        onPaste?.(e);
        if (e.defaultPrevented) return;
        const el = e.currentTarget, texto = e.clipboardData.getData("text");
        const proposta = el.selectionStart == null ? texto : el.value.slice(0, el.selectionStart) + texto + el.value.slice(el.selectionEnd ?? el.selectionStart);
        if (!valido(regra === "decimal" ? completarZeroDecimal(proposta) : proposta)) e.preventDefault();
      }}
    />
  )
}

export { Input }
