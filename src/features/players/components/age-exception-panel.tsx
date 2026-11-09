"use client";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { FormDialog } from "@/components/ui/form-dialog";
import { ageExceptionCommandSchema, ageExceptionStateSchema, type AgeExceptionState } from "../age-exception";
import { playerRequest, PlayerRequestError } from "../player-client";
import { playerErrorMessages } from "../player-feedback";
import { PrivateDocumentPreview } from "./private-document-preview";

const receipt = z.object({ confirmed: z.literal(true), registrationId: z.uuid(), operationKey: z.uuid(), requestId: z.uuid(), action: z.enum(["REQUEST", "DECIDE"]) });
const statusLabels: Record<AgeExceptionState["status"], string> = {
  NOT_REQUIRED: "Sin solicitud de excepción", DRAFT: "Falta presentar la petición", PENDING: "Pendiente de decisión por Secretaría",
  APPROVED: "Excepción de edad aceptada", REJECTED: "Petición rechazada", STALE: "La petición requiere actualización", UNAVAILABLE: "La excepción no está disponible con los datos actuales",
};
const secondary = "min-h-12 rounded-xl border border-border bg-surface px-4 py-3 font-semibold text-primary disabled:opacity-50";
export function AgeExceptionPanel(props: { actorId: string; registrationId: string; fetcher?: typeof fetch }) {
  return <PanelContent key={`${props.actorId}:${props.registrationId}`} {...props} />;
}
function PanelContent({ actorId, registrationId, fetcher = fetch }: { actorId: string; registrationId: string; fetcher?: typeof fetch }) {
  const prefix = useId(), reasonRef = useRef<HTMLTextAreaElement>(null), lock = useRef(true);
  const pending = useRef<z.infer<typeof ageExceptionCommandSchema> | null>(null);
  const [state, setState] = useState<AgeExceptionState | null>(null), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(true), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<"APPROVE" | "REJECT" | null>(null), [preview, setPreview] = useState(false);
  const path = `/api/player-registrations/${registrationId}/age-exception`;
  useEffect(() => {
    let active = true;
    playerRequest(actorId, path, undefined, fetcher).then(value => {
      const parsed = ageExceptionStateSchema.parse(value);
      if (parsed.registrationId !== registrationId) throw Error();
      if (active) setState(parsed);
    }).catch(() => { if (active) setMessage("No se pudo consultar la excepción. Actualiza el estado."); })
      .finally(() => { if (active) { lock.current = false; setBusy(false); } });
    return () => { active = false; };
  }, [actorId, registrationId, path, fetcher]);
  useEffect(() => {
    if (!uncertain && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [uncertain, busy]);
  function failure(error: unknown) {
    if (error instanceof PlayerRequestError && ["FORBIDDEN", "UNAUTHENTICATED", "PASSWORD_CHANGE_REQUIRED"].includes(error.code)) {
      setState(null); setReason(""); setPreview(false); setConfirm(null); pending.current = null; setUncertain(false);
    }
    setMessage(error instanceof PlayerRequestError ? playerErrorMessages[error.code] ?? "No se pudo confirmar la operación. Consulta el estado." : "No se pudo confirmar la operación. Consulta el estado.");
  }
  async function readState() {
    const value = ageExceptionStateSchema.parse(await playerRequest(actorId, path, undefined, fetcher));
    if (value.registrationId !== registrationId) throw Error();
    setState(value); setPreview(false); return value;
  }
  async function refresh() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setPreview(false);
    try {
      if (pending.current) {
        const value = await playerRequest(actorId, `${path}?operationKey=${pending.current.operationKey}`, undefined, fetcher);
        const result = receipt.safeParse(value);
        if (result.success && result.data.registrationId === registrationId && result.data.operationKey === pending.current.operationKey && result.data.action === pending.current.action) {
          pending.current = null; setUncertain(false); setConfirm(null); setReason("");
          setMessage("El servidor confirmó el envío anterior. No se volvió a enviar.");
        } else {
          const absent = z.object({ confirmed: z.literal(false), registrationId: z.literal(registrationId), operationKey: z.literal(pending.current.operationKey) }).safeParse(value);
          if (!absent.success) throw Error();
          setMessage("Todavía no se confirma el envío anterior. Puedes consultar otra vez o reintentar el mismo envío.");
        }
      } else setMessage("");
      await readState();
    } catch (error) { failure(error); }
    finally { lock.current = false; setBusy(false); }
  }
  async function send() {
    const body = pending.current;
    if (!body || lock.current) return;
    lock.current = true; setBusy(true); setMessage(""); setPreview(false);
    let acknowledged = false;
    try {
      const value = receipt.parse(await playerRequest(actorId, path, body, fetcher));
      if (value.registrationId !== registrationId || value.operationKey !== body.operationKey || value.action !== body.action || body.action === "DECIDE" && value.requestId !== body.requestId) throw Error();
      acknowledged = true; pending.current = null; setUncertain(false); setConfirm(null); setReason("");
      setMessage(body.action === "REQUEST" ? "Petición enviada a Secretaría. El jugador continúa sin habilitación deportiva." : "Decisión registrada. La habilitación deportiva se revisa por separado.");
      try { await readState(); } catch (error) { failure(error); setMessage("La operación fue confirmada, pero no se pudo actualizar el estado. Consulta otra vez."); }
    } catch (error) {
      if (!acknowledged && (!(error instanceof PlayerRequestError) || error.uncertain)) {
        setUncertain(true); setMessage("No se confirmó la respuesta. Conservamos el mismo envío; consulta su resultado antes de intentar otra operación.");
      } else { pending.current = null; setUncertain(false); setConfirm(null); failure(error); }
    } finally { lock.current = false; setBusy(false); }
  }
  function prepare(decision?: "APPROVE" | "REJECT") {
    if (!state || busy || uncertain || pending.current) return;
    if (!reason.trim()) { setMessage("Escribe el motivo antes de continuar."); reasonRef.current?.focus(); return; }
    const parsed = ageExceptionCommandSchema.safeParse(decision ? {
      action: "DECIDE", decision, reason, requestId: state.requestId, fingerprint: state.fingerprint, operationKey: crypto.randomUUID(),
    } : { action: "REQUEST", reason, documentId: state.documentId, fingerprint: state.fingerprint, operationKey: crypto.randomUUID() });
    if (!parsed.success) { setMessage("Revisa el motivo y confirma que cargaste la carta. Después actualiza el estado."); return; }
    pending.current = parsed.data; void send();
  }
  if (state && !state.applicable) return null;
  const frozen = busy || uncertain;
  return <section className="space-y-4 rounded-2xl border border-border bg-surface p-5" aria-label="Excepción de edad" aria-busy={busy}>
    <h2 className="text-xl font-semibold text-primary">Excepción de edad</h2>
    {state && <>
      <p className="font-semibold">{statusLabels[state.status]}</p>
      {state.rule && <p className="text-sm leading-6 text-muted">Año de referencia: {state.rule.referenceYear}. Rango ordinario: {state.rule.minimumAge} a {state.rule.maximumAge ?? "sin máximo"} años. Mínimo excepcional: {state.rule.exceptionMinimumAge ?? "no configurado"} años.</p>}
      <p className="text-sm leading-6">La carta de excepción es distinta del consentimiento del tutor. Aceptar la excepción resuelve solo la edad; no habilita automáticamente al jugador.</p>
      {!state.documentId && <p>Carga y confirma la <strong>Carta de excepción de edad</strong> en los documentos del expediente y después actualiza este estado.</p>}
      {state.documentId && <button type="button" className={secondary} disabled={frozen} onClick={() => setPreview(true)}>Consultar carta privada</button>}
      {state.requestReason && <p className="whitespace-pre-wrap break-words">Motivo de la petición: {state.requestReason}</p>}
      {state.decisionReason && <p className="whitespace-pre-wrap break-words">Motivo de Secretaría: {state.decisionReason}</p>}
      {(state.canRequest || state.canReview) && <div>
        <label htmlFor={`${prefix}-reason`} className="block text-sm font-medium">{state.canReview ? "Motivo de la decisión" : "Motivo de la petición"} *</label>
        <textarea ref={reasonRef} id={`${prefix}-reason`} value={reason} maxLength={1000} required disabled={frozen || confirm !== null} onChange={e => setReason(e.target.value)} className="mt-2 min-h-28 w-full rounded-xl border border-border bg-background p-3" />
      </div>}
      {state.canRequest && <button type="button" disabled={frozen || !state.documentId} onClick={() => prepare()} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50">Solicitar revisión a Secretaría</button>}
      {state.canReview && <div className="flex flex-wrap gap-3"><button type="button" disabled={frozen} onClick={() => { if (!reason.trim()) { reasonRef.current?.focus(); setMessage("Escribe el motivo de la decisión."); } else setConfirm("APPROVE"); }} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50">Aceptar excepción</button><button type="button" disabled={frozen} onClick={() => { if (!reason.trim()) { reasonRef.current?.focus(); setMessage("Escribe el motivo de la decisión."); } else setConfirm("REJECT"); }} className={secondary}>Rechazar petición</button></div>}
    </>}
    {message && <p role="status" className="whitespace-pre-wrap break-words text-sm leading-6">{message}</p>}
    <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || confirm !== null && !uncertain} onClick={() => void refresh()} className={secondary}>{busy ? "Consultando o enviando…" : uncertain ? "Consultar resultado del envío" : "Actualizar estado"}</button>{uncertain && <button type="button" disabled={busy} onClick={() => void send()} className={secondary}>Reintentar el mismo envío</button>}</div>
    <FormDialog open={confirm !== null} title={confirm === "APPROVE" ? "Confirmar aceptación de excepción" : "Confirmar rechazo de petición"} description="Se registrará la decisión sobre esta carta y esta versión de la petición. No se aprobarán otros requisitos del jugador." pending={busy} uncertain={uncertain} onClose={() => { if (!busy) setConfirm(null); }}>
      <p className="mb-4 whitespace-pre-wrap break-words">{reason}</p>
      {!uncertain ? <div className="flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => { if (confirm) prepare(confirm); }} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold">Confirmar decisión</button><button type="button" disabled={busy} onClick={() => setConfirm(null)} className={secondary}>Cancelar</button></div> : <div className="space-y-3"><p role="status">{message}</p><button type="button" disabled={busy} onClick={() => void refresh()} className={secondary}>Consultar resultado del envío</button><button type="button" disabled={busy} onClick={() => void send()} className={secondary}>Reintentar el mismo envío</button></div>}
    </FormDialog>
    {preview && state?.documentId && <PrivateDocumentPreview actorId={actorId} request={{ label: "Carta de excepción de edad", path: `/api/player-documents/${state.documentId}/download`, body: {} }} onClose={() => setPreview(false)} />}
  </section>;
}
