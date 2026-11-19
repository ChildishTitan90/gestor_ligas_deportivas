"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { recoveryCompletionSchema, recoveryRequestSchema } from "../schemas";

const inputClass = "mt-1 w-full rounded-xl border border-border bg-surface px-3 py-3";

export function PasswordRecoveryForm({ reset }: { reset: boolean }) {
  const token = useRef<string | null>(null);
  const initialized = useRef(false);
  const submitting = useRef(false);
  const [validLink, setValidLink] = useState(false);
  const [ready, setReady] = useState(!reset);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!reset || initialized.current) return;
    function readLink() {
      initialized.current = true;
      const received = new URLSearchParams(window.location.hash.slice(1)).get("token");
      token.current = received && /^[A-Za-z0-9_-]{43}$/.test(received) ? received : null;
      if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
      setValidLink(Boolean(token.current));
      setReady(true);
    }
    readLink();
  }, [reset]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || done) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = reset
      ? recoveryCompletionSchema.safeParse({ ...fields, token: token.current })
      : recoveryRequestSchema.safeParse(fields);
    if (!parsed.success) {
      setMessage(reset ? "Verifica que la contraseña cumpla los requisitos y que ambas coincidan." : "Escribe un correo válido.");
      return;
    }
    submitting.current = true;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/auth/recovery/${reset ? "complete" : "request"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const { code } = await response.json();
      if (response.ok) {
        setDone(true);
        token.current = null;
        setValidLink(false);
        setMessage(reset ? "Contraseña actualizada. Inicia sesión con la nueva contraseña."
          : "Si el correo está habilitado para recuperación, recibirás las instrucciones.");
      } else if (code === "INVALID_LINK") {
        token.current = null;
        setValidLink(false);
        setMessage("El enlace ya no es válido. Solicita uno nuevo.");
      } else setMessage("No se pudo completar la operación. Inténtalo más tarde.");
    } catch { setMessage("No se pudo confirmar la operación. Inténtalo más tarde."); }
    finally { submitting.current = false; setPending(false); }
  }

  const invalidLink = reset && ready && !done && !validLink;
  return <>
    <p role="status">{message || (invalidLink ? "Abre un enlace válido o solicita uno nuevo." : "")}</p>
    {ready && !done && !invalidLink && <form onSubmit={submit} method="post" className="space-y-4">
      {reset ? <>
        <p className="text-sm text-muted">Usa de 8 a 128 caracteres con mayúscula, minúscula, número y símbolo.</p>
        <label className="block">Nueva contraseña<input className={inputClass} name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>
        <label className="block">Confirmar contraseña<input className={inputClass} name="confirmPassword" type="password" autoComplete="new-password" maxLength={128} required /></label>
      </> : <label className="block">Correo de acceso<input className={inputClass} name="email" type="email" autoComplete="email" maxLength={254} required /></label>}
      <button className="primary-action min-h-12 rounded-xl px-4" disabled={pending}>{pending ? "Procesando…" : reset ? "Cambiar contraseña" : "Solicitar enlace"}</button>
    </form>}
    {invalidLink && <Link href="/recover-password" className="underline">Solicitar otro enlace</Link>}
    <Link href="/login" className="block underline">Volver al inicio de sesión</Link>
  </>;
}
