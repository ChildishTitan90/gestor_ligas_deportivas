"use client";

import Link from "next/link";
import { Globe, KeyRound, LayoutDashboard } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { SignOutButton } from "./sign-out-button";

export function AccountMenu({
  username, initials, roleNames = [], mustChangePassword = false, publicView = false,
}: {
  username: string | null;
  initials: string;
  roleNames?: readonly string[];
  mustChangePassword?: boolean;
  publicView?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<"first" | "last">("first");
  const label = username ? `@${username}` : "Mi cuenta";

  function items() {
    return Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
  }

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const controls = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    (initialFocus.current === "last" ? controls.at(-1) : controls[0])?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onFocusIn(event: FocusEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      initialFocus.current = event.key === "ArrowUp" ? "last" : "first";
      if (open) (initialFocus.current === "last" ? items().at(-1) : items()[0])?.focus();
      else setOpen(true);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close(true);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      // Continuar el recorrido normal desde el disparador, fuera del menú.
      close(true);
    } else if (event.key === " " && event.target instanceof HTMLAnchorElement) {
      event.preventDefault();
      event.target.click();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const controls = items();
      const index = controls.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
      controls[next]?.focus();
    }
  }

  return <div ref={container} className="relative flex min-w-0 shrink-0 items-center gap-2.5">
    <button ref={trigger} type="button" aria-label={`Menú de cuenta de ${label}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
      onClick={() => {
        initialFocus.current = "first";
        if (open) close(); else setOpen(true);
      }} onKeyDown={onTriggerKeyDown}
      className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-soft text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-background">
      <span aria-hidden="true">{initials}</span>
    </button>
    <div className="min-w-0 max-w-24 sm:max-w-48 md:max-w-64">
      <p title={label} className="truncate text-sm font-semibold text-primary">{label}</p>
      {roleNames.length > 0 && <p className="mt-0.5 text-xs leading-5 text-muted [overflow-wrap:anywhere]">{roleNames.join(" · ")}</p>}
    </div>
    <div ref={menu} id={menuId} role="menu" aria-label="Opciones de la cuenta" hidden={!open}
      onKeyDown={onMenuKeyDown}
      className="absolute top-full right-0 z-20 mt-3 w-56 max-w-[calc(100vw-3rem)] rounded-2xl border border-border bg-surface p-2 shadow-lg">
      <Link role="menuitem" tabIndex={-1} href={mustChangePassword ? "/change-password" : "/access"}
        onClick={() => close()} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-soft focus:bg-soft">
        {mustChangePassword ? <KeyRound size={18} aria-hidden="true" /> : <LayoutDashboard size={18} aria-hidden="true" />}
        {mustChangePassword ? "Cambiar contraseña" : publicView ? "Ir a mi panel" : "Mi panel"}
      </Link>
      <Link role="menuitem" tabIndex={-1} href="/futbol" onClick={() => close()}
        className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-soft focus:bg-soft">
        <Globe size={18} aria-hidden="true" />
        Portal público
      </Link>
      <div role="separator" className="my-1 h-px bg-border" />
      <SignOutButton variant="menu-item" />
    </div>
  </div>;
}
