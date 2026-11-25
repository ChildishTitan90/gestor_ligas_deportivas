"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { ProcessSteps } from "@/components/ui/process-steps";
import { recoveryCompletionSchema, recoveryRequestSchema } from "../schemas";

const inputClass = "mt-1 min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2 text-base";
const steps = ["Solicitar enlace", "Nueva contraseña", "Contraseña actualizada"];

export function PasswordRecoveryForm({ reset }: { reset: boolean }) {
  const token = useRef<string | null>(null);
  const initialized = useRef(false);
  const submitting = useRef(false);
  const outcome = useRef<HTMLDivElement>(null);
  const [validLink, setValidLink] = useState(false);
  const [ready, setReady] = useState(!reset);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  const invalidLink = reset && ready && !done && !validLink;
  const updated = reset && done;
  const currentStep = updated ? 2 : validLink || done ? 1 : 0;

  useEffect(() => {
    if (!reset) return;
    function readLink(initial = false) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const hasToken = params.has("token");
      if (!initial && !hasToken) return;
      const received = params.get("token");
      if (hasToken) window.history.replaceState(window.history.state, "", window.location.pathname);
      if (submitting.current) return;
      token.current = received && /^[A-Za-z0-9_-]{43}$/.test(received) ? received : null;
      setValidLink(Boolean(token.current));
      setMessage("");
      setDone(false);
      setReady(true);
    }
    if (!initialized.current) {
      initialized.current = true;
      readLink(true);
    }
    const onHashChange = () => readLink();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [reset]);

  useEffect(() => {
    if (done || invalidLink) outcome.current?.focus();
  }, [done, invalidLink]);

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
      if (response.ok && code === (reset ? "PASSWORD_CHANGED" : "REQUEST_RECEIVED")) {
        setDone(true);
        token.current = null;
        setValidLink(false);
      } else if (code === "RATE_LIMITED") {
        setMessage("Has realizado demasiados intentos. Inténtalo más tarde.");
      } else if (code === "INVALID_LINK") {
        token.current = null;
        setValidLink(false);
      } else setMessage("No se pudo completar la operación. Inténtalo más tarde.");
    } catch {
      setMessage(reset ? "No se pudo confirmar el cambio. Comprueba si puedes iniciar sesión con la nueva contraseña."
        : "No se pudo confirmar la solicitud. Revisa tu correo o inténtalo más tarde.");
    }
    finally { submitting.current = false; setPending(false); }
  }

  if (!ready) return <p role="status" className="text-sm text-muted">Preparando el formulario de recuperación…</p>;

  return <>
    <ProcessSteps steps={steps} current={currentStep} label="Etapas de recuperación"
      completedSteps={[currentStep > 0, updated, updated]} />
    {(done || invalidLink) ? <div ref={outcome} tabIndex={-1} role={invalidLink ? "alert" : "status"}
      className={`space-y-1 rounded-xl border border-border p-4 text-sm leading-6 ${updated ? "bg-positive-surface text-positive" : "bg-background"}`}>
      <h2 className="font-semibold">{invalidLink ? "El enlace ya no es válido" : updated ? "Contraseña actualizada" : "Revisa tu correo"}</h2>
      <p>{invalidLink ? "Solicita un enlace nuevo para continuar." : updated ? "Inicia sesión con tu nueva contraseña."
        : "Si el correo está habilitado para recuperación, recibirás las instrucciones para crear una nueva contraseña."}</p>
    </div> : <form onSubmit={submit} method="post" aria-busy={pending} className="space-y-4">
      {message && <p role="alert" className="rounded-xl border border-danger/25 bg-danger-surface p-3 text-sm text-danger">{message}</p>}
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-70">
        <legend className="sr-only">{reset ? "Escribe tu nueva contraseña" : "Correo de acceso"}</legend>
        {reset ? <>
          <p id="recovery-password-help" className="text-sm leading-6 text-muted">Usa de 8 a 128 caracteres con mayúscula, minúscula, número y símbolo.</p>
          <label className="block">Nueva contraseña<input className={inputClass} name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required aria-describedby="recovery-password-help" /></label>
          <label className="block">Confirmar contraseña<input className={inputClass} name="confirmPassword" type="password" autoComplete="new-password" maxLength={128} required /></label>
        </> : <label className="block">Correo de acceso<input className={inputClass} name="email" type="email" autoComplete="email" maxLength={254} required /></label>}
        <button type="submit" className="primary-action min-h-12 w-full rounded-xl px-5 font-semibold disabled:opacity-65" disabled={pending}>
          {pending ? (reset ? "Guardando contraseña…" : "Procesando solicitud…") : reset ? "Cambiar contraseña" : "Solicitar enlace"}
        </button>
      </fieldset>
    </form>}
    <div className="flex flex-wrap gap-3">
      {invalidLink && <ActionLink href="/recover-password">Solicitar otro enlace</ActionLink>}
      <ActionLink href="/login" variant={updated ? "primary" : "secondary"}>{updated ? "Iniciar sesión" : "Volver al inicio de sesión"}</ActionLink>
    </div>
  </>;
}
