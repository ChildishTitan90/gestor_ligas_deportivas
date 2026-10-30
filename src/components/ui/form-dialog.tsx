"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { ClipboardPenLine, X } from "lucide-react";

type Props = {
  open: boolean;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  dirty?: boolean;
  pending?: boolean;
  uncertain?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: (reason: "dismiss" | "discard") => void;
};

/** Cerrar oculta el diálogo, no desmonta su captura ni cancela una petición enviada. */
export function FormDialog({ open, title, description, children, footer, dirty = false, pending = false,
  uncertain = false, initialFocusRef, onClose }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const outsidePointer = useRef(false);
  const [discarding, setDiscarding] = useState(false);
  const continueButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !dialog.current) return;
    const node = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      (initialFocusRef?.current ?? node.querySelector<HTMLElement>("[data-dialog-initial]") ?? node.querySelector<HTMLElement>("textarea:not(:disabled), input:not([type='hidden']):not(:disabled), button:not(:disabled)"))?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      node.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open || (!dirty && !pending && !uncertain)) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty, pending, uncertain]);

  function finish(reason: "dismiss" | "discard") { setDiscarding(false); onClose(reason); }
  function focusEditor() {
    (initialFocusRef?.current ?? dialog.current?.querySelector<HTMLElement>("textarea:not(:disabled), input:not([type='hidden']):not(:disabled), [data-dialog-initial]"))?.focus();
  }
  function requestClose() {
    if (pending) return;
    if (dirty && !uncertain) { setDiscarding(true); requestAnimationFrame(() => continueButton.current?.focus()); }
    else finish("dismiss");
  }
  const secondary = "min-h-12 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold text-primary disabled:opacity-50";
  return <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    data-reusable-dialog="" className="m-auto overflow-hidden rounded-3xl border border-border bg-surface p-0 text-foreground shadow-xl"
    style={{ width: "min(42rem, calc(100vw - 2rem))", maxHeight: "calc(100dvh - 2rem)", padding: 0 }}
    onCancel={event => { event.preventDefault(); if (discarding) {
      setDiscarding(false); requestAnimationFrame(focusEditor);
    } else requestClose(); }}
    onPointerDown={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      outsidePointer.current = event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    }}
    onClick={event => { if (event.target === event.currentTarget && outsidePointer.current) requestClose(); }}>
    <div className="flex flex-col" style={{ maxHeight: "calc(100dvh - 2rem)" }}>
      <div className="flex shrink-0 items-start gap-4 px-5 py-5 sm:px-7" style={{ background: "var(--sidebar)", color: "var(--sidebar-foreground)" }}>
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--sidebar-active)" }}><ClipboardPenLine size={24} /></span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">{title}</h2>
          <p id={`${id}-description`} className="mt-1 text-sm leading-6 opacity-90">{description}</p>
        </div>
        <button type="button" onClick={requestClose} disabled={pending} aria-label={`Cerrar: ${title}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-50"><X size={23} aria-hidden="true" /></button>
      </div>
      <div inert={discarding} className="min-h-0 overflow-y-auto p-5 sm:p-7" style={{ overscrollBehavior: "contain" }}>{children}</div>
      {discarding ? <div role="alert" className="shrink-0 space-y-4 border-t border-border bg-background p-5 sm:px-7">
        <p className="font-semibold text-primary">¿Descartar los cambios sin guardar?</p>
        <p className="text-sm text-muted">Todavía no se enviaron. Puedes continuar editando o descartarlos.</p>
        <div className="flex flex-wrap justify-end gap-3">
          <button ref={continueButton} type="button" className={secondary} onClick={() => { setDiscarding(false); requestAnimationFrame(focusEditor); }}>Seguir editando</button>
          <button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold" onClick={() => finish("discard")}>Descartar cambios</button>
        </div>
      </div> : <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border bg-background p-5 sm:px-7">
        {pending && <p role="status" className="w-full text-sm text-muted">Esperando la respuesta del servidor. Cerrar no cancelaría el envío.</p>}
        <button type="button" data-dialog-initial="" className={secondary} disabled={pending} onClick={requestClose}>{uncertain ? "Cerrar y conservar pendiente" : "Cancelar"}</button>
        {footer}
      </div>}
    </div>
  </dialog>;
}
