"use client";
import { useEffect, useRef, useState } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import { canRetryCurpVerification, type CurpVerificationStatus } from "../curp-verification";
import { curpStateSchema, playerRequest, PlayerRequestError } from "../player-client";
import { curpStatusLabels, identityFieldLabels, playerErrorMessages } from "../player-feedback";
import { isProviderBlocked } from "../provider-retry";
import { ProviderRetryAuthorization } from "./provider-retry-authorization";

export function CurpVerificationPanel({ actorId, registrationId, providerConfigured = false, fetcher = fetch, onRegistrationChange, recoveryOnly = false }: {
  actorId: string; registrationId: string; providerConfigured?: boolean; fetcher?: typeof fetch; onRegistrationChange?:()=>void; recoveryOnly?: boolean;
}) {
  const [state, setState] = useState<CurpVerificationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [consultRequired, setConsultRequired] = useState(false);
  const pending = useRef<{ operationKey: string; identityVersion: number; confirmCharge: true; retryOf?: string } | undefined>(undefined);
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
      if (pending.current && (parsed.data.identityVersion !== pending.current.identityVersion ||
        !["NOT_PERFORMED", "NOT_CONFIGURED", "STALE"].includes(parsed.data.status) && parsed.data.checkId !== pending.current.retryOf)) pending.current = undefined;
      setConsultRequired(false);
      setMessage("Estado consultado. Esta lectura no envía otra consulta al proveedor.");
    } catch (error) { setMessage(error instanceof PlayerRequestError ? playerErrorMessages[error.code] ?? "No se pudo confirmar el estado." : "No se pudo confirmar el estado."); }
    finally { locked.current = false; setBusy(false); }
  }

  const canRetry = state && canRetryCurpVerification(state.status, state.providerRetryAuthorized);
  const canVerify = !recoveryOnly && providerConfigured && !consultRequired && state &&
    (state.status === "NOT_PERFORMED" || state.status === "STALE" || canRetry);
  async function verify() {
    if (locked.current || !state || !canVerify) return;
    locked.current = true; setBusy(true); setMessage("");
    pending.current ??= { operationKey: crypto.randomUUID(), identityVersion: state.identityVersion, confirmCharge: true,
      ...(state.checkId && canRetry ? { retryOf: state.checkId } : {}) };
    try {
      const parsed = curpStateSchema.safeParse(await playerRequest(actorId, endpoint, pending.current, fetcher));
      if (!parsed.success) throw new PlayerRequestError("UNCONFIRMED", true);
      setState(parsed.data); pending.current = undefined; setConfirming(false);
      if(parsed.data.registrationStatus==="ACTIVE")onRegistrationChange?.();
      if(parsed.data.status==="VERIFIED" && parsed.data.registrationStatus==="ACTIVE")
        setMessage("Jugador activo. Puedes completar su expediente con la constancia CURP y la foto.");
    } catch (error) {
      if (error instanceof PlayerRequestError && !error.uncertain) pending.current = undefined;
      else setConsultRequired(true);
      setConfirming(false);
      setMessage(error instanceof PlayerRequestError && !error.uncertain ? playerErrorMessages[error.code] ?? "No se pudo realizar la consulta."
        : "No se recibió una respuesta confirmada. Consulta el estado antes de decidir cualquier reintento; la consulta anterior pudo procesarse.");
    } finally { locked.current = false; setBusy(false); }
  }

  async function reevaluate(){
    if(locked.current)return;locked.current=true;setBusy(true);
    try{const value=curpStateSchema.parse(await playerRequest(actorId,`/api/player-registrations/${registrationId}/activation`,{},fetcher));setState(value);setMessage(value.registrationStatus==="ACTIVE"?"Jugador activo. No se volvió a consultar al proveedor.":"La habilitación sigue pendiente de coincidencias o requisitos de categoría. No se realizó otra consulta externa.");if(value.registrationStatus==="ACTIVE")onRegistrationChange?.();}
    catch{setMessage("No se pudo confirmar la habilitación. Consulta el estado antes de reintentar; esta operación no consulta Verificamex.");}finally{locked.current=false;setBusy(false);}
  }
  const providerBlocked = state && isProviderBlocked(state.status);
  if (recoveryOnly && !providerBlocked) return null;
  return <section className="space-y-4 rounded-2xl border border-border bg-surface p-5" aria-label="Verificación de CURP">
    <h3 className="font-semibold text-primary">Verificación externa de CURP</h3>
    <div role="status" className={`space-y-2 rounded-xl border p-4 ${state?.status === "VERIFIED" ? "border-positive bg-positive-surface text-positive" : "border-border bg-background"}`}>
      <p className="font-semibold">{state ? curpStatusLabels[state.status] : "Consultando el estado del registro…"}</p>
      {state?.status === "DISCREPANCY" && state.mismatchedFields.length > 0 &&
        <p className="text-sm">Campos que no coinciden: {state.mismatchedFields.map(field => identityFieldLabels[field]).join(", ")}.</p>}
    </div>
    {!recoveryOnly && state?.registrationStatus && <p role="status">{state.registrationStatus==="ACTIVE"?"Jugador activo":state.identityReviewStatus==="REQUIRED"?"Pendiente de revisión por posibles coincidencias":"Pendiente de habilitación"}</p>}
    {!recoveryOnly && <p className="text-sm leading-6 text-muted">Para mayores fuera de Veteranos, una CURP verificada y coincidente permite la habilitación automática si no hay duplicados pendientes y cumplen las reglas de categoría. La constancia se puede añadir después para completar el expediente.</p>}
    {!recoveryOnly && !providerConfigured && <p className="text-sm">La consulta externa todavía no está configurada. El registro local puede consultarse.</p>}
    {providerBlocked && state.checkId && <ProviderRetryAuthorization key={state.checkId} kind="CURP" actorId={actorId} registrationId={registrationId}
      attemptId={state.checkId} state={state} disabled={busy} fetcher={fetcher} onAuthorized={value => setState(curpStateSchema.parse(value))} />}
    {message && <p role="status" className="text-sm leading-6">{message}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void check()} className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold text-primary disabled:opacity-50">Consultar estado</button>
      {canVerify && <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold text-primary disabled:opacity-50">{canRetry ? "Reintentar verificación" : "Verificar CURP"}</button>}
      {state?.status==="VERIFIED" && state.registrationStatus==="INELIGIBLE" && <button type="button" disabled={busy} onClick={()=>void reevaluate()} className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold">Actualizar habilitación</button>}
    </div>
    <FormDialog open={confirming} title="Consultar CURP con Verificamex" description="Se contrastará la CURP con los datos del jugador." pending={busy} onClose={() => setConfirming(false)}
      footer={<div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-12 rounded-xl border border-border px-5 py-3">Cancelar</button>
        <button type="button" disabled={busy || !canVerify} onClick={() => void verify()} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50">{busy ? "Consultando…" : "Verificar CURP"}</button></div>}>
      <p className="text-sm leading-6">Se contrastarán los datos guardados de esta inscripción. Un adulto fuera de Veteranos puede quedar activo automáticamente si cumple la política y no hay coincidencias pendientes. Los casos dudosos se revisan; un fallo técnico no rechaza al jugador.</p>
    </FormDialog>
  </section>;
}
