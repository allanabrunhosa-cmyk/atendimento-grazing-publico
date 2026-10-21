"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

export function CampoSenha({ className = "", ...props }: Omit<ComponentProps<typeof Input>, "type">) {
  const [visivel, definirVisivel] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visivel ? "text" : "password"} className={`pr-12 ${className}`} />
      <button type="button" disabled={props.disabled} aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={visivel} aria-controls={props.id} onClick={() => definirVisivel(!visivel)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">
        {visivel ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
}
