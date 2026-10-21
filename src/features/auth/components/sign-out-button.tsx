"use client";

import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { signOutCurrentSession } from "../client/sign-out.client";

export function SignOutButton({ className = "", variant = "button" }: { className?: string; variant?: "button" | "menu-item" }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSignOut() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await signOutCurrentSession();
      window.location.replace("/login");
    } catch {
      setFailed(true);
      pending.current = false;
      setBusy(false);
    }
  }

  return <>
    {failed && <p role="alert" className="mt-5 text-sm text-danger">No pudimos cerrar tu sesión. Inténtalo de nuevo.</p>}
    <button type="button" onClick={handleSignOut} disabled={busy} aria-busy={busy}
      role={variant === "menu-item" ? "menuitem" : undefined} tabIndex={variant === "menu-item" ? -1 : undefined}
      className={`${variant === "menu-item"
        ? "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-primary hover:bg-soft focus:bg-soft"
        : "mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border px-5 py-3 text-sm font-semibold text-primary transition-colors hover:bg-background"} disabled:opacity-70 ${className}`}>
      {variant === "menu-item" && <LogOut size={18} aria-hidden="true" />}
      {busy ? "Cerrando sesión…" : "Cerrar sesión"}
    </button>
  </>;
}
