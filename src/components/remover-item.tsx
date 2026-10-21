"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

/** Remove um item do rascunho; a gravação continua a cargo do formulário. */
export function BotaoRemoverItem({ nome, discreto = false, ...props }: Omit<ComponentProps<typeof Button>, "children" | "variant" | "size" | "className" | "aria-label" | "title"> & { nome: string; discreto?: boolean }) {
  return <Button {...props} type="button" variant={discreto ? "excluir-discreto" : "excluir"} data-acao={discreto ? "remover-discreto" : "remover-item"} aria-label={nome} title={nome} />;
}
