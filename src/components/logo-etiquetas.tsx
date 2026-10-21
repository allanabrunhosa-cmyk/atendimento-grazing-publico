import { LogoMark } from "@/components/logo";

/** Identidade do portal, seguindo a mesma composição visual do Grazing HUB. */
export function LogoEtiquetas({ className = "" }: { className?: string }) {
  return <div className={`flex items-center gap-3 ${className}`}>
    <LogoMark className="size-10 shrink-0 shadow-sm" label="Grazing Validades" monograma="GV" />
    <div className="min-w-0">
      <span className="block truncate text-base font-semibold tracking-tight">Grazing Validades</span>
      <span className="block truncate text-xs text-muted-foreground">by Grazing Table &amp; Co</span>
    </div>
  </div>;
}
