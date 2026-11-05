"use client";
import { useEffect, useRef, useState } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import type { CurpVerificationStatus } from "../curp-verification";
import { curpStateSchema, playerRequest, PlayerRequestError } from "../player-client";
import { curpStatusLabels, playerErrorMessages } from "../player-feedback";

export function CurpVerificationPanel({ actorId, registrationId, providerConfigured, fetcher = fetch,onRegistrationChange }: {
  actorId: string; registrationId: string; providerConfigured: boolean; fetcher?: typeof fetch;onRegistrationChange?:()=>void;
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
      if(parsed.data.registrationStatus==="ACTIVE")onRegistrationChange?.();
      setMessage(parsed.data.registrationStatus==="ACTIVE"?"Jugador activo. Puedes completar su expediente con la constancia CURP y la foto.":parsed.data.identityReviewStatus==="REQUIRED"?"CURP consultada. Hay posibles coincidencias de identidad que requieren revisión.":"Consulta procesada. El jugador sigue pendiente de los requisitos que correspondan a su categoría.");
    } catch (error) {
      if (error instanceof PlayerRequestError && !error.uncertain) pending.current = undefined;
      setConfirming(false);
      setMessage(error instanceof PlayerRequestError && !error.uncertain ? playerErrorMessages[error.code] ?? "No se pudo realizar la consulta."
        : "No se recibió una respuesta confirmada. Consulta el estado antes de decidir cualquier reintento; la consulta anterior pudo procesarse.");
    } finally { locked.current = false; setBusy(false); }
  }

  const canVerify = providerConfigured && state && !["VERIFIED", "PENDING", "STALE"].includes(state.status);
  async function reevaluate(){
    if(locked.current)return;locked.current=true;setBusy(true);
    try{const value=curpStateSchema.parse(await playerRequest(actorId,`/api/player-registrations/${registrationId}/activation`,{},fetcher));setState(value);setMessage(value.registrationStatus==="ACTIVE"?"Jugador activo. No se volvió a consultar al proveedor.":"La habilitación sigue pendiente de coincidencias o requisitos de categoría. No se realizó otra consulta externa.");if(value.registrationStatus==="ACTIVE")onRegistrationChange?.();}
    catch{setMessage("No se pudo confirmar la habilitación. Consulta el estado antes de reintentar; esta operación no consulta Verificamex.");}finally{locked.current=false;setBusy(false);}
  }
  return <section className="space-y-4 rounded-2xl border border-border bg-surface p-5" aria-label="Verificación de CURP">
    <h3 className="font-semibold text-primary">Verificación externa de CURP</h3>
    <p role="status">{state ? curpStatusLabels[state.status] : "Consultando el estado del registro…"}</p>
    {state?.registrationStatus && <p role="status">{state.registrationStatus==="ACTIVE"?"Jugador activo":state.identityReviewStatus==="REQUIRED"?"Pendiente de revisión por posibles coincidencias":"Pendiente de habilitación"}</p>}
    <p className="text-sm leading-6 text-muted">Para mayores fuera de Veteranos, una CURP verificada y coincidente permite la habilitación automática si no hay duplicados pendientes y cumplen las reglas de categoría. La constancia se puede añadir después para completar el expediente.</p>
    {!providerConfigured && <p className="text-sm">La consulta externa todavía no está configurada. El registro local puede consultarse.</p>}
    {message && <p role="status" className="text-sm leading-6">{message}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void check()} className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold text-primary disabled:opacity-50">Consultar estado</button>
      <button type="button" disabled={busy || !canVerify} onClick={() => { setAcknowledged(false); setConfirming(true); }} className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold text-primary disabled:opacity-50">{state?.checkId ? "Nueva consulta externa" : "Verificar CURP"}</button>
      {state?.status==="VERIFIED" && state.registrationStatus==="INELIGIBLE" && <button type="button" disabled={busy} onClick={()=>void reevaluate()} className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold">Actualizar habilitación</button>}
    </div>
    <FormDialog open={confirming} title="Consultar CURP con Verificamex" description="Se contrastará la CURP con los datos del jugador." pending={busy} onClose={() => setConfirming(false)}
      footer={<div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-12 rounded-xl border border-border px-5 py-3">Cancelar</button>
        <button type="button" disabled={busy || (state?.status === "UNCERTAIN" && !acknowledged)} onClick={() => void verify()} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50">{busy ? "Consultando…" : "Verificar CURP"}</button></div>}>
      <p className="text-sm leading-6">Se contrastarán los datos guardados de esta inscripción. Un adulto fuera de Veteranos puede quedar activo automáticamente si cumple la política y no hay coincidencias pendientes. Los casos dudosos se revisan; un fallo técnico no rechaza al jugador.</p>
      {state?.status === "UNCERTAIN" && <label className="mt-4 flex gap-3 text-sm leading-6"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 size-5 shrink-0" />Revisé el intento anterior y entiendo que la consulta anterior pudo procesarse; quiero realizar una nueva consulta.</label>}
    </FormDialog>
  </section>;
}
