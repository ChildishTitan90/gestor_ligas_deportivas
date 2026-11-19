"use client";

import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { signOutCurrentSession } from "../client/sign-out.client";
import { FormDialog } from "@/components/ui/form-dialog";
import { clearLocalReports, hasPendingLocalReports } from "@/features/match-reports/offline/store.client";

export function SignOutButton({ className = "", variant = "button" }: { className?: string; variant?: "button" | "menu-item" | "sidebar" }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [discardOffline, setDiscardOffline] = useState(false);

  async function handleSignOut(discard = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (!discard && "indexedDB" in window && await hasPendingLocalReports()) {
        setDiscardOffline(true); pending.current = false; setBusy(false); return;
      }
      if ("indexedDB" in window) await clearLocalReports();
      await signOutCurrentSession();
      window.location.replace("/login");
    } catch {
      setFailed(true);
      pending.current = false;
      setBusy(false);
    }
  }

  return <>
    {failed && <p role="alert" className={`text-sm text-danger ${variant === "sidebar" ? "mb-3 rounded-xl bg-danger-surface p-3" : "mt-5"}`}>No pudimos cerrar tu sesión. Inténtalo de nuevo.</p>}
    <button type="button" onClick={() => void handleSignOut()} disabled={busy} aria-busy={busy}
      role={variant === "menu-item" ? "menuitem" : undefined} tabIndex={variant === "menu-item" ? -1 : undefined}
      className={`${variant === "menu-item"
        ? "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-primary hover:bg-soft focus:bg-soft"
        : variant === "sidebar"
          ? "sidebar-link flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors"
          : "mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border px-5 py-3 text-sm font-semibold text-primary transition-colors hover:bg-background"} disabled:opacity-70 ${className}`}>
      {variant !== "button" && <LogOut size={18} aria-hidden="true" className="shrink-0" />}
      {busy ? "Cerrando sesión…" : "Cerrar sesión"}
    </button>
    <FormDialog open={discardOffline} title="Hay cédulas pendientes en este dispositivo" description="Cerrar sesión eliminará las copias y operaciones locales que aún no recibieron acuse." onClose={() => setDiscardOffline(false)}
      footer={<button type="button" className="primary-action min-h-12 rounded-xl px-4 py-3 font-semibold" onClick={() => { setDiscardOffline(false); void handleSignOut(true); }}>Eliminar copias locales y cerrar sesión</button>}>
      <p>Puedes cancelar, recuperar conexión y sincronizar antes de salir. Los borradores ya recibidos por el servidor se conservan en la base.</p>
    </FormDialog>
  </>;
}
