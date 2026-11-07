"use client";

import { useEffect, useRef, useState } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { confirmEmailToken, readEmailConfirmationFragment, type EmailConfirmationOutcome } from "../email-confirmation.client";

type State = "loading" | "ready" | "pending" | EmailConfirmationOutcome;
export function EmailConfirmationForm() {
  const [state, setState] = useState<State>("loading");
  const token = useRef<string | null>(null);
  const initialized = useRef(false), submitting = useRef(false);
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function readLink() {
      const next = readEmailConfirmationFragment(window.location.hash);
      // Replace the history entry; never put the secret in props, HTML or storage.
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      if (submitting.current) return;
      token.current = next;
      setState(next ? "ready" : "invalid");
    }
    if (!initialized.current) { initialized.current = true; readLink(); }
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  useEffect(() => {
    if (["confirmed", "invalid", "uncertain"].includes(state)) result.current?.focus();
  }, [state]);

  async function confirm() {
    if (submitting.current || !token.current || state !== "ready") return;
    submitting.current = true;
    setState("pending");
    const outcome = await confirmEmailToken(token.current);
    token.current = null;
    submitting.current = false;
    setState(outcome);
  }
  return <div className="space-y-5">
    {state === "loading" && <p role="status">Preparando confirmación…</p>}
    {(state === "ready" || state === "pending") && <form onSubmit={event => { event.preventDefault(); void confirm(); }} className="space-y-5">
      <p id="email-confirmation-effects">Abrir este enlace no cambia tu cuenta. Al confirmar se aplicará el nuevo correo de acceso y se cerrarán las sesiones anteriores. El enlace solo puede utilizarse una vez.</p>
      <button type="submit" disabled={state === "pending"} aria-describedby="email-confirmation-effects"
        className="primary-action min-h-12 w-full rounded-xl px-5 py-3 font-semibold disabled:opacity-50">
        {state === "pending" ? "Confirmando…" : "Confirmar correo"}
      </button>
      {state === "pending" && <p role="status">Esperando la respuesta del servidor…</p>}
    </form>}
    {["confirmed", "invalid", "uncertain"].includes(state) && <div ref={result} tabIndex={-1} role={state === "confirmed" ? "status" : "alert"} className="rounded-xl border border-border p-4">
      {state === "confirmed" ? <><h2 className="font-semibold">Correo confirmado</h2><p>Tu nuevo correo ya está vigente. Las sesiones anteriores se revocaron. Inicia sesión nuevamente para continuar.</p></>
        : state === "invalid" ? <><h2 className="font-semibold">El enlace ya no es válido</h2><p>Puede haber vencido, haberse utilizado o haber sido reemplazado. Solicita a la administración una nueva solicitud de cambio de correo.</p></>
        : <><h2 className="font-semibold">No se pudo comprobar el resultado</h2><p>La confirmación pudo haberse aplicado. No se repetirá automáticamente. Comprueba el acceso con el correo vigente o pide a la administración que consulte el estado antes de iniciar otro cambio.</p></>}
    </div>}
    <ActionLink href="/login" variant="secondary">Ir a iniciar sesión</ActionLink>
  </div>;
}
