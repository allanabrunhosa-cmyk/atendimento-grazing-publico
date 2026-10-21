import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LogoMark } from "@/components/logo";
import { ShieldCheck } from "lucide-react";
import { LogoEtiquetas } from "@/components/logo-etiquetas";

export function PainelAcesso({ titulo, descricao, children, marca = "padrao" }: { titulo: string; descricao: string; children: ReactNode; marca?: "padrao" | "atendimento" }) {
  return <main className="tela-login px-4 py-8">
    <Card className="vidro-painel w-full max-w-md py-8 [--card-spacing:--spacing(7)]">
      <CardHeader className="items-center justify-items-center gap-2 text-center">
        {marca === "atendimento" ? <>
          <div className="marca-acesso-atendimento"><LogoMark className="mb-1 size-12" label="Grazing Atendimento" monograma="GA" /></div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Grazing Atendimento</p>
        </> : <>
        <div className="marca-acesso-hub"><LogoMark className="mb-1 size-12" /></div>
        <div className="marca-acesso-etiquetas w-64 max-w-full"><LogoEtiquetas /></div>
        <div className="marca-acesso-pedidos"><LogoMark className="mb-1 size-12" label="Grazing Pedidos" monograma="GP" /></div>
        <p className="marca-acesso-hub text-xs font-semibold uppercase tracking-widest text-muted-foreground">Grazing HUB</p>
        <p className="marca-acesso-pedidos text-xs font-semibold uppercase tracking-widest text-muted-foreground">Grazing Pedidos</p>
        </>}
        <CardTitle className="text-2xl">{titulo}</CardTitle>
        <CardDescription className="text-sm leading-relaxed">{descricao}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{children}
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" /> Acesso exclusivo à sua operação</p>
      </CardContent>
    </Card>
  </main>;
}
