"use client";

import { useRef, useState } from "react";
import { signOutCurrentSession } from "../client/sign-out.client";

export function SignOutButton() {
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
      className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border px-5 py-3 text-sm font-semibold text-primary transition-colors hover:bg-background disabled:opacity-70">
      {busy ? "Cerrando sesión…" : "Salir de la cuenta"}
    </button>
  </>;
}
