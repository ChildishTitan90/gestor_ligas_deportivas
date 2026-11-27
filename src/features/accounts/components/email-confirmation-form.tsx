"use client";

import { useEffect, useRef, useState } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { ProcessSteps } from "@/components/ui/process-steps";
import { confirmEmailToken, readEmailConfirmationFragment, type EmailConfirmationOutcome } from "../email-confirmation.client";

type State = "loading" | "ready" | "pending" | EmailConfirmationOutcome;
export function EmailConfirmationForm() {
  const [state, setState] = useState<State>("loading");
  const token = useRef<string | null>(null);
  const initialized = useRef(false), submitting = useRef(false);
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function readLink(initial = false) {
      const hash = window.location.hash;
      const hasToken = new URLSearchParams(hash.slice(1)).has("token");
      if (!initial && !hasToken) return;
      const next = readEmailConfirmationFragment(hash);
      // Replace the history entry; never put the secret in props, HTML or storage.
      if (hasToken) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      if (submitting.current) return;
      token.current = next;
      setState(next ? "ready" : "invalid");
    }
    if (!initialized.current) { initialized.current = true; readLink(true); }
    const onHashChange = () => readLink();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
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
  const confirmed = state === "confirmed";
  return <div className="space-y-5">
    {state === "loading" && <p role="status">Preparando confirmación…</p>}
    {(state === "ready" || state === "pending" || confirmed) && <ProcessSteps label="Etapas de confirmación de correo"
      steps={["Confirmar cambio", "Correo confirmado"]} current={confirmed ? 1 : 0} completedSteps={[confirmed, confirmed]} />}
    {(state === "ready" || state === "pending") && <form aria-busy={state === "pending"} onSubmit={event => { event.preventDefault(); void confirm(); }} className="space-y-5">
      <p id="email-confirmation-effects" className="text-sm leading-6 text-muted">Confirma para activar el nuevo correo de acceso y cerrar tus sesiones anteriores. El enlace se puede usar una sola vez.</p>
      <button type="submit" disabled={state === "pending"} aria-describedby="email-confirmation-effects"
        className="primary-action min-h-12 w-full rounded-xl px-5 py-3 font-semibold disabled:opacity-50">
        {state === "pending" ? "Confirmando…" : "Confirmar correo"}
      </button>
      {state === "pending" && <p role="status">Esperando la respuesta del servidor…</p>}
    </form>}
    {["confirmed", "invalid", "uncertain"].includes(state) && <div ref={result} tabIndex={-1} role={confirmed ? "status" : "alert"}
      className={`space-y-1 rounded-xl border border-border p-4 text-sm leading-6 ${confirmed ? "bg-positive-surface text-positive" : "bg-background"}`}>
      {confirmed ? <><h2 className="font-semibold">Correo confirmado</h2><p>Inicia sesión con tu nuevo correo. Las sesiones anteriores se cerraron.</p></>
        : state === "invalid" ? <><h2 className="font-semibold">El enlace ya no es válido</h2><p>Puede haber vencido, haberse utilizado o haber sido reemplazado. Pide a la administración que genere un enlace nuevo.</p></>
        : <><h2 className="font-semibold">No se pudo comprobar el resultado</h2><p>La confirmación pudo haberse aplicado. Comprueba si puedes iniciar sesión con el nuevo correo o pide a la administración que consulte el estado.</p></>}
    </div>}
    <ActionLink href="/login" variant={confirmed ? "primary" : "secondary"}>Ir a iniciar sesión</ActionLink>
  </div>;
}
