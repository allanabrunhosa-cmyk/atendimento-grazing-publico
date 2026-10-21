"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "cn";

function Popover({ modal = false, ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root modal={modal} {...props} />;
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/** Painel ancorado: foco, Escape e interação externa pertencem ao Base UI. */
function PopoverContent({
  align = "start", alignOffset = 0, side = "bottom", sideOffset = 4,
  className, ...props
}: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return <PopoverPrimitive.Portal>
    <PopoverPrimitive.Positioner className="isolate z-50 outline-none" align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset}>
      <PopoverPrimitive.Popup
        data-slot="popover-content"
        className={cn("w-60 max-w-[min(calc(100vw-1rem),var(--available-width))] max-h-[min(25rem,var(--available-height))] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-[var(--ds-popup-raio)] vidro-painel p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none duration-[var(--ds-movimento-rapido)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className)}
        {...props}
      />
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>;
}

function PopoverClose(props: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title data-slot="popover-title" className={cn("text-sm font-semibold", className)} {...props} />;
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return <PopoverPrimitive.Description data-slot="popover-description" className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverClose, PopoverTitle, PopoverDescription };
