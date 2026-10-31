"use client";
import { useEffect, useRef, useState } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import type { CurpVerificationStatus } from "../curp-verification";
import { curpStateSchema, playerRequest, PlayerRequestError } from "../player-client";
import { curpStatusLabels, playerErrorMessages } from "../player-feedback";

export function CurpVerificationPanel({ actorId, registrationId, providerConfigured, fetcher = fetch }: {
  actorId: string; registrationId: string; providerConfigured: boolean; fetcher?: typeof fetch;
}) {
  const [state, setState] = useState<CurpVerificationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const pending = useRef<unknown>(undefined);
  const locked = useRef(false);
  const endpoint = `/api/player-registrations/${registrationId}/curp-verification`;

  useEffect(() => {
    let active = true;
    playerRequest(actorId, endpoint, undefined, fetcher).then(value => {
      const parsed = curpStateSchema.safeParse(value);
      if (!active) return;
      if (parsed.success) setState(parsed.data);
      else setMessage("No se pudo confirmar el estado. Intenta consultarlo nuevamente.");
    }).catch(() => { if (active) setMessage("No se pudo consultar el estado. Intenta consultarlo nuevamente."); });
    return () => { active = false; };
  }, [actorId, endpoint, fetcher]);

  async function check() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage("");
    try {
      const parsed = curpStateSchema.safeParse(await playerRequest(actorId, endpoint, undefined, fetcher));
      if (!parsed.success) throw new PlayerRequestError("UNCONFIRMED", true);
      setState(parsed.data);
      if (!["NOT_PERFORMED", "NOT_CONFIGURED"].includes(parsed.data.status)) pending.current = undefined;
      setMessage("Estado consultado. Esta lectura no envía otra consulta al proveedor.");
    } catch (error) { setMessage(error instanceof PlayerRequestError ? playerErrorMessages[error.code] ?? "No se pudo confirmar el estado." : "No se pudo confirmar el estado."); }
    finally { locked.current = false; setBusy(false); }
  }

  async function verify() {
    if (locked.current || !state) return;
    locked.current = true; setBusy(true); setMessage("");
    pending.current ??= { operationKey: crypto.randomUUID(), identityVersion: state.identityVersion, confirmCharge: true,
      ...(state.checkId ? { retryOf: state.checkId } : {}),
      ...(state.status === "UNCERTAIN" ? { acknowledgePossiblePreviousCharge: acknowledged } : {}) };
    try {
      const parsed = curpStateSchema.safeParse(await playerRequest(actorId, endpoint, pending.current, fetcher));
      if (!parsed.success) throw new PlayerRequestError("UNCONFIRMED", true);
      setState(parsed.data); pending.current = undefined; setConfirming(false);
      setMessage("Consulta procesada. El resultado no aprueba al jugador para competir.");
    } catch (error) {
      if (error instanceof PlayerRequestError && !error.uncertain) pending.current = undefined;
      setConfirming(false);
      setMessage(error instanceof PlayerRequestError && !error.uncertain ? playerErrorMessages[error.code] ?? "No se pudo realizar la consulta."
        : "No se recibió una respuesta confirmada. Consulta el estado antes de decidir cualquier reintento; el proveedor pudo cobrar.");
    } finally { locked.current = false; setBusy(false); }
  }

  const canVerify = providerConfigured && state && !["VERIFIED", "PENDING", "STALE"].includes(state.status);
  return <section className="space-y-4 rounded-2xl border border-border bg-surface p-5" aria-label="Verificación de CURP">
    <h3 className="font-semibold text-primary">Verificación externa de CURP</h3>
    <p role="status">{state ? curpStatusLabels[state.status] : "Consultando el estado del registro…"}</p>
    <p className="text-sm leading-6 text-muted">La validación local revisa formato y nacimiento. La consulta externa contrasta los datos; no acredita la titularidad ni sustituye la revisión deportiva.</p>
    {!providerConfigured && <p className="text-sm">La consulta externa todavía no está configurada. El registro local puede consultarse.</p>}
    {message && <p role="status" className="text-sm leading-6">{message}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void check()} className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold text-primary disabled:opacity-50">Consultar estado</button>
      <button type="button" disabled={busy || !canVerify} onClick={() => { setAcknowledged(false); setConfirming(true); }} className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold text-primary disabled:opacity-50">{state?.checkId ? "Nueva consulta externa" : "Verificar CURP"} · 3 tokens</button>
    </div>
    <FormDialog open={confirming} title="Consultar CURP con Verificamex" description="La consulta de datos puede consumir 3 tokens. No se solicitará PDF." pending={busy} onClose={() => setConfirming(false)}
      footer={<div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-12 rounded-xl border border-border px-5 py-3">Cancelar</button>
        <button type="button" disabled={busy || (state?.status === "UNCERTAIN" && !acknowledged)} onClick={() => void verify()} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50">{busy ? "Consultando…" : "Consultar CURP · 3 tokens"}</button></div>}>
      <p className="text-sm leading-6">Se contrastarán los datos guardados de esta inscripción. El resultado no aprueba ni rechaza automáticamente al jugador.</p>
      {state?.status === "UNCERTAIN" && <label className="mt-4 flex gap-3 text-sm leading-6"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 size-5 shrink-0" />Revisé el intento anterior y entiendo que ya pudo tener un cobro; quiero realizar una nueva consulta.</label>}
    </FormDialog>
  </section>;
}
