import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Pencil, X } from "lucide-react"
import { Children, isValidElement, type ReactNode } from "react"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--ds-botao-raio)] border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-[background-color,border-color,box-shadow,transform] duration-[var(--ds-movimento-rapido)] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-[color-mix(in_oklch,var(--primary),black_8%)] active:bg-[color-mix(in_oklch,var(--primary),black_10%)]",
        outline:
          "border-border/80 bg-card/80 text-foreground shadow-xs hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_8%)] aria-expanded:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_8%)] dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)] aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)]",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        editar:
          "border-editar/30 bg-editar-bg text-editar hover:brightness-95 focus-visible:border-editar focus-visible:ring-editar/25",
        excluir:
          "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:border-destructive focus-visible:ring-destructive/25 dark:bg-destructive/15 dark:hover:bg-destructive/25",
        "excluir-discreto":
          "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:ring-destructive/25",
        destructive:
          "border-destructive bg-destructive text-white hover:brightness-95 focus-visible:border-destructive focus-visible:ring-destructive/25 dark:text-red-950",
        entrada:
          "border-success bg-success text-white shadow-sm hover:bg-[color-mix(in_oklch,var(--success),black_8%)] focus-visible:border-success focus-visible:ring-success/25 dark:text-emerald-950",
        "entrada-outline":
          "border-success/30 bg-success-bg/55 text-success shadow-xs hover:bg-success-bg focus-visible:border-success/50 focus-visible:ring-success/20",
        saida:
          "border-destructive bg-destructive text-white shadow-sm hover:bg-[color-mix(in_oklch,var(--destructive),black_8%)] focus-visible:border-destructive focus-visible:ring-destructive/25 dark:text-red-950",
        "saida-outline":
          "border-destructive/25 bg-destructive/5 text-destructive shadow-xs hover:bg-destructive/10 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/10 dark:hover:bg-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[var(--ds-controle-altura)] gap-2 px-5 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[var(--ds-controle-altura-compacta)] gap-1.5 px-3.5 text-[0.8rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-[var(--ds-controle-altura)] gap-2 px-6 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-[var(--ds-controle-altura)]",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[var(--ds-controle-altura-compacta)]",
        "icon-lg": "size-[var(--ds-controle-altura)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function textoDaAcao(children: ReactNode): string {
  return Children.toArray(children).map(c => typeof c === "string" || typeof c === "number" ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textoDaAcao(c.props.children) : "").join(" ").trim();
}

function Button({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const rotulo = props["aria-label"] ?? props.title ?? textoDaAcao(children);
  const remover = variant === "excluir" || variant === "excluir-discreto" || /^(remover|retirar|excluir)\b/i.test(rotulo);
  const cancelar = /^cancelar\b/i.test(rotulo);
  const compacta = variant === "editar" || remover;
  const nomeAcao = variant === "editar" ? "Editar" : rotulo || "Excluir";
  return (
    <ButtonPrimitive
      data-slot="button"
      data-acao={remover ? variant === "excluir-discreto" ? "remover-discreto" : "excluir" : cancelar ? "cancelar" : compacta ? variant : undefined}
      className={cn(buttonVariants({ variant: remover ? variant === "excluir-discreto" ? "excluir-discreto" : "excluir" : cancelar ? "outline" : variant, size: compacta ? "icon-sm" : size, className }), compacta && "ds-acao-compacta p-0")}
      {...props}
      aria-label={props["aria-label"] ?? (compacta ? props.title ?? nomeAcao : undefined)}
      title={props.title ?? (compacta ? props["aria-label"] ?? nomeAcao : undefined)}
    >{variant === "editar" ? <Pencil className="size-3.5" /> : remover ? <X className="size-3.5" /> : children}</ButtonPrimitive>
  )
}

export { Button, buttonVariants, textoDaAcao }
