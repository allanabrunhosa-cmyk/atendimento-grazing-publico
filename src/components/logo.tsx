// Marca do Grazing HUB: quadrado navy arredondado, monograma "GH" branco
// e uma barra azul de destaque — igual ao manual de marca (seção 03, Ícone/App Icon).
export function LogoMark({ className, label = "Grazing HUB", monograma = "GH" }: { className?: string; label?: string; monograma?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={label}>
      <rect width="40" height="40" rx="11" fill="var(--brand-navy)" />
      <text
        x="20"
        y="24"
        textAnchor="middle"
        fontFamily="var(--font-heading), sans-serif"
        fontWeight="700"
        fontSize="15"
        letterSpacing="-0.5"
        fill="var(--brand-white)"
      >
        {monograma}
      </text>
      <rect x="10" y="28" width="20" height="3" rx="1.5" fill="var(--brand-blue)" />
    </svg>
  );
}

export function TaglineBadge({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground ${className ?? ""}`}
    >
      by Grazing Table &amp; Co
    </span>
  );
}
