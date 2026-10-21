"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { cn } from "cn"

import { Button, textoDaAcao } from "@/components/ui/button"
import { TriangleAlert, XIcon } from "lucide-react"

type DialogContextValue = {
  idDialogo: string
  suspenso: boolean
  registrarFilho: (id: string, aberto: boolean) => void
  marcarAlterado: () => void
  fechamentoPendente: boolean
  continuar: () => void
  descartar: () => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

type DialogProps = DialogPrimitive.Root.Props & {
  protegerAlteracoes?: boolean
  /** Quando informado, o formulário controla a existência de alterações não salvas. */
  alterado?: boolean
}

function Dialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onOpenChangeComplete,
  protegerAlteracoes = true,
  alterado,
  ...props
}: DialogProps) {
  const contextoPai = React.useContext(DialogContext)
  const [filhosAbertos, setFilhosAbertos] = React.useState<string[]>([])
  const registrarFilho = React.useCallback((id: string, aberto: boolean) => {
    setFilhosAbertos(atuais => aberto ? atuais.includes(id) ? atuais : [...atuais, id] : atuais.filter(filho => filho !== id))
  }, [])
  const [openInterno, setOpenInterno] = React.useState(defaultOpen)
  const [fechamentoPendente, setFechamentoPendente] = React.useState<DialogPrimitive.Root.ChangeEventDetails | null>(null)
  const alteradoRef = React.useRef(false)
  const idDialogo = React.useId()
  const open = openProp ?? openInterno

  const registrarNoPai = contextoPai?.registrarFilho
  React.useLayoutEffect(() => {
    if (!open || !registrarNoPai) return
    registrarNoPai(idDialogo, true)
    return () => registrarNoPai(idDialogo, false)
  }, [open, idDialogo, registrarNoPai])

  const focoAnterior = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!open || !protegerAlteracoes) return

    function pertenceAoDialogo(evento: Event) {
      const alvo = evento.target
      if (!(alvo instanceof Element)) return false
      return alvo.closest("[data-dialogo-id]")?.getAttribute("data-dialogo-id") === idDialogo
    }

    function marcarCampoAlterado(evento: Event) {
      if (pertenceAoDialogo(evento)) alteradoRef.current = true
    }

    function marcarControleAlterado(evento: MouseEvent) {
      if (!pertenceAoDialogo(evento)) return
      const alvo = evento.target
      if (!(alvo instanceof Element)) return
      if (alvo.closest('[role="checkbox"], [role="radio"], [role="switch"], [role="option"], [aria-pressed], [data-dialogo-altera]')) {
        alteradoRef.current = true
      }
    }

    document.addEventListener("input", marcarCampoAlterado, true)
    document.addEventListener("change", marcarCampoAlterado, true)
    document.addEventListener("click", marcarControleAlterado, true)
    return () => {
      document.removeEventListener("input", marcarCampoAlterado, true)
      document.removeEventListener("change", marcarCampoAlterado, true)
      document.removeEventListener("click", marcarControleAlterado, true)
    }
  }, [idDialogo, open, protegerAlteracoes])

  function alterarAbertura(nextOpen: boolean, detalhes: DialogPrimitive.Root.ChangeEventDetails) {
    if (!nextOpen && protegerAlteracoes && (alterado ?? alteradoRef.current)) {
      detalhes.cancel()
      if (fechamentoPendente) { if (detalhes.reason === "escape-key") continuarEdicao(); return }
      focoAnterior.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setFechamentoPendente(detalhes)
      return
    }

    if (nextOpen) {
      alteradoRef.current = false
      setFechamentoPendente(null)
    } else {
      alteradoRef.current = false
    }
    if (openProp === undefined) setOpenInterno(nextOpen)
    onOpenChange?.(nextOpen, detalhes)
  }

  function descartarAlteracoes() {
    const detalhes = fechamentoPendente
    alteradoRef.current = false
    setFechamentoPendente(null)
    if (openProp === undefined) setOpenInterno(false)
    if (detalhes) onOpenChange?.(false, detalhes)
  }

  function continuarEdicao() {
    setFechamentoPendente(null)
    requestAnimationFrame(() => focoAnterior.current?.focus({ preventScroll: true }))
  }

  const contexto: DialogContextValue = {
    idDialogo,
    suspenso: filhosAbertos.length > 0,
    registrarFilho,
    marcarAlterado: () => { if (protegerAlteracoes) alteradoRef.current = true },
    fechamentoPendente: fechamentoPendente !== null,
    continuar: continuarEdicao,
    descartar: descartarAlteracoes,
  }

  return (
    <DialogContext.Provider value={contexto}>
      <DialogPrimitive.Root
        data-slot="dialog"
        {...props}
        open={open}
        onOpenChange={alterarAbertura}
        onOpenChangeComplete={(nextOpen) => {
          if (!nextOpen) {
            alteradoRef.current = false
            setFechamentoPendente(null)
          }
          onOpenChangeComplete?.(nextOpen)
        }}
      />

    </DialogContext.Provider>
  )
}

/** Única camada modal sobreposta permitida: decisão explícita sobre o rascunho. */
export function ConfirmacaoDescarteDialogo({ aberto, continuar, descartar, descricao = "As alterações feitas neste formulário serão perdidas." }: {
  aberto: boolean; continuar: () => void; descartar: () => void; descricao?: string;
}) {
  const botaoContinuar = React.useRef<HTMLButtonElement>(null)
  return <AlertDialogPrimitive.Root open={aberto} onOpenChange={(proximo, detalhes) => { if (!proximo) { detalhes.cancel(); continuar(); } }}>
    <AlertDialogPrimitive.Portal>
      <DialogOverlay forceRender />
      <AlertDialogPrimitive.Popup data-slot="confirmacao-descarte" className={cn(classeConteudoDialogo, "max-h-[calc(100dvh-2rem)] overflow-y-auto")} initialFocus={botaoContinuar} finalFocus={false}>
        <div className="flex items-start gap-3"><TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-destructive" /><div className="space-y-2">
          <AlertDialogPrimitive.Title className="font-heading text-base font-semibold">Sair sem salvar?</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-sm text-muted-foreground">{descricao}</AlertDialogPrimitive.Description>
        </div></div>
        <div className="flex flex-wrap gap-2"><Button ref={botaoContinuar} type="button" className="btn" variant="outline" onClick={continuar}>Continuar editando</Button><Button type="button" className="btn" variant="destructive" onClick={descartar}>Sair sem salvar</Button></div>
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  </AlertDialogPrimitive.Root>
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  const cancelar = /^cancelar\b/i.test(props["aria-label"] ?? props.title ?? textoDaAcao(props.children));
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} {...cancelar ? {"data-acao":"cancelar"} : {}} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-[var(--ds-movimento-rapido)] supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

const classeConteudoDialogo = "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[var(--ds-dialogo-raio)] vidro-painel p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 shadow-lg duration-[var(--ds-movimento-rapido)] outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onInputCapture,
  onChangeCapture,
  onClickCapture,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const contexto = React.useContext(DialogContext)

  function pertenceAoDialogo(evento: React.SyntheticEvent) {
    const alvo = evento.target
    if (!(alvo instanceof Element)) return false
    return alvo.closest("[data-dialogo-id]")?.getAttribute("data-dialogo-id") === contexto?.idDialogo
  }

  function cliqueAlteraFormulario(evento: Parameters<NonNullable<typeof onClickCapture>>[0]) {
    onClickCapture?.(evento)
    if (evento.defaultPrevented || !pertenceAoDialogo(evento)) return
    const alvo = evento.target as Element
    if (alvo.closest('[role="checkbox"], [role="radio"], [role="switch"], [role="option"], [aria-pressed], [data-dialogo-altera]')) {
      contexto?.marcarAlterado()
    }
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-dialogo-id={contexto?.idDialogo}
        data-dialogo-suspenso={contexto?.suspenso || undefined}
        inert={contexto?.suspenso || undefined}
        className={cn(
          classeConteudoDialogo,
          "data-closed:invisible data-closed:pointer-events-none",
          contexto?.suspenso && "invisible pointer-events-none",
          className
        )}
        onInputCapture={(evento) => {
          onInputCapture?.(evento)
          if (!evento.defaultPrevented && pertenceAoDialogo(evento)) contexto?.marcarAlterado()
        }}
        onChangeCapture={(evento) => {
          onChangeCapture?.(evento)
          if (!evento.defaultPrevented && pertenceAoDialogo(evento)) contexto?.marcarAlterado()
        }}
        onClickCapture={cliqueAlteraFormulario}
        {...props}
      >
        {contexto && <ConfirmacaoDescarteDialogo aberto={contexto.fechamentoPendente} continuar={contexto.continuar} descartar={contexto.descartar} />}
        <div className="contents" inert={contexto?.fechamentoPendente || contexto?.suspenso || undefined}>{children}</div>
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            disabled={contexto?.fechamentoPendente}
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-[var(--ds-dialogo-raio)] border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Fechar
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
