"use client";

import { Check, Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const APARENCIAS = [
  { valor: "light", nome: "Claro", icone: Sun },
  { valor: "dark", nome: "Escuro", icone: Moon },
  { valor: "system", nome: "Automático", icone: Monitor },
];

export function SeletorAparencia() {
  const { theme: tema, setTheme: definirTema } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Alterar aparência" />}>
        <SunMoon className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <p className="px-2 py-2 text-xs font-medium text-muted-foreground">Aparência</p>
        {APARENCIAS.map(({ valor, nome, icone: Icone }) => (
          <DropdownMenuItem key={valor} onClick={() => definirTema(valor)} className="gap-2">
            <Icone className="size-4" />{nome}
            {tema === valor && <Check className="ml-auto size-4" aria-label="Selecionado" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
