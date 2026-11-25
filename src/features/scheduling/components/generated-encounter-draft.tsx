"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { venueTimeToIso } from "@/features/venues/time";
import { z } from "zod";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { actionButton, fieldClass, sendSchedulingRequest } from "./scheduling-request";

const captureSchema = z.strictObject({
  startsAt: z.iso.datetime({ local: true, precision: -1 }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  venueId: z.uuid(),
  reason: z.string().trim().min(8).max(500),
  swapHomeAway: z.boolean().default(false),
  uncertain: z.boolean().default(false),
});

export function GeneratedEncounterDraft({ actorId, proposalId, version, encounterIndex, initialStart, initialVenueId, timeZone, venues, context }: {
  actorId: string; proposalId: string; version: number; encounterIndex: number;
  initialStart: string; initialVenueId: string; timeZone: string;
  venues: { value: string; label: string }[];
  context?: string;
}) {
  const id = useId();
  const router = useRouter();
  const busy = useRef(false);
  const key = `schedule-adjustment:${actorId}:${proposalId}:${version}:${encounterIndex}`;
  const [open, setOpen] = useState(false);
  const [startsAt, setStartsAt] = useState(initialStart);
  const [venueId, setVenueId] = useState(initialVenueId);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [swapHomeAway, setSwapHomeAway] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [pending, setPending] = useState(false);
  const [options, setOptions] = useState<{value:string;label:string}[] | null>(null);

  function openDraft() {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const capture = captureSchema.parse(JSON.parse(raw));
        setStartsAt(capture.startsAt);
        setVenueId(capture.venueId);
        setReason(capture.reason);
        setSwapHomeAway(capture.swapHomeAway);
        setUncertain(capture.uncertain);
        setSaved(true);
      }
      setMessage("");
      setOpen(true);
    } catch {
      setMessage("No se pudo recuperar el borrador guardado en esta pestaña.");
    }
  }

  async function consultVenues() {
    if (busy.current) return;
    let utc:string;
    try { utc=venueTimeToIso(startsAt,timeZone); }
    catch { setMessage("Elige una fecha y hora válidas antes de consultar."); return; }
    if (!utc) { setMessage("Elige una fecha y hora válidas antes de consultar."); return; }
    busy.current=true; setPending(true); setMessage(""); setOptions(null);
    try {
      const outcome=await sendSchedulingRequest("/api/scheduling/stored-venue-options",actorId,
        {proposalId,expectedVersion:version,encounterIndex,startsAt:utc,swapHomeAway},"VENUE_OPTIONS");
      if(outcome.error) { setMessage(outcome.error); return; }
      const available=outcome.result.venues.map((venue:{venueId:string;name:string;preferred:boolean})=>
        ({value:venue.venueId,label:venue.name+(venue.preferred ? " · Horario preferente de local" : "")}));
      setOptions(available);
      setVenueId(current=>available.some((item:{value:string})=>item.value===current)?current:"");
      if(!available.length) setMessage("No hay canchas disponibles y autorizadas para este encuentro a esa hora. Prueba otra fecha u horario.");
    } catch { setMessage("No se pudo consultar la disponibilidad. Inténtalo nuevamente."); }
    finally { busy.current=false; setPending(false); }
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const parsed = captureSchema.safeParse({ startsAt, venueId, reason, swapHomeAway, uncertain: true });
    const utc = venueTimeToIso(startsAt, timeZone);
    if (!parsed.success || !utc || !venues.some(venue => venue.value === venueId)) {
      setMessage("Revisa el horario, selecciona una cancha de la lista y escribe un motivo de al menos 8 caracteres.");
      return;
    }
    try {
      sessionStorage.setItem(key, JSON.stringify(parsed.data));
      setSaved(true);
    } catch {
      setMessage("No se pudo guardar el borrador en esta pestaña. Conserva abierto el formulario.");
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage("");
    setUncertain(true);
    try {
      const outcome = await sendSchedulingRequest("/api/scheduling/adjustments", actorId, {
        proposalId, expectedVersion: version, encounterIndex, venueId, startsAt: utc,
        swapHomeAway, reason: reason.trim(),
      }, "ADJUSTMENT_SAVED");
      if (outcome.error) {
        setMessage(outcome.error);
        if (!["STALE_PROPOSAL", "ADJUSTMENT_CONFLICT", "INVALID_PROPOSAL_TRANSITION"].includes(outcome.code ?? "")) {
          setUncertain(false);
          sessionStorage.setItem(key, JSON.stringify({ ...parsed.data, uncertain: false }));
        }
        // Incluso ante una versión obsoleta conservamos la captura para cotejar el resultado.
        return;
      }
      sessionStorage.removeItem(key);
      setUncertain(false);
      setOpen(false);
      setMessage("Ajuste guardado y calendario revalidado.");
      router.refresh();
    } catch {
      setMessage("No se confirmó el guardado. Conservamos la captura y su versión. Comprueba la propuesta o reintenta la misma solicitud.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function change() { setSaved(false); setMessage(""); }

  return <>
    <button type="button" className="mt-2 rounded-xl border border-border px-3 py-2 text-sm font-medium"
      onClick={openDraft}>{uncertain ? "Recuperar ajuste" : "Ajustar encuentro"}</button>
    {!open && message && <p role="alert" className="text-sm">{message}</p>}
    {open && <FormDialog open title="Ajustar encuentro" description={`${context ?? "Encuentro propuesto"} · ${timeZone}. Versión ${version}.`}
      pending={pending} uncertain={uncertain}
      dirty={!saved && (startsAt !== initialStart || venueId !== initialVenueId || swapHomeAway || Boolean(reason))}
      onClose={closeReason => {
        if (closeReason === "discard") {
          try { sessionStorage.removeItem(key); }
          catch { setMessage("No se pudo retirar el borrador de esta pestaña."); return; }
          setStartsAt(initialStart); setVenueId(initialVenueId); setReason(""); setSwapHomeAway(false); setSaved(false); setMessage("");
        }
        setOpen(false);
      }}>
      <form onSubmit={saveDraft} className="space-y-3">
        <fieldset disabled={pending || uncertain} className="space-y-3">
        <label className="block text-sm">Horario propuesto · {timeZone}
          <input type="datetime-local" required className={fieldClass} value={startsAt}
            onChange={event => { setStartsAt(event.target.value); setOptions(null); change(); }} />
        </label>
        <button type="button" onClick={consultVenues} className="min-h-11 rounded-xl border border-border px-3 py-2 text-sm font-medium">Consultar canchas disponibles</button>
        <p className="text-sm text-muted">La consulta considera el horario, la autorización y los partidos registrados. El horario preferente se marca en la lista.</p>
        <label className="block text-sm" htmlFor={id}>Cancha propuesta</label>
        <SelectField id={id} value={venueId} options={options ?? venues}
          onValueChange={value => { setVenueId(value); change(); }} />
        <label className="block text-sm">Motivo del ajuste
          <textarea required minLength={8} maxLength={500} className={fieldClass} value={reason}
            onChange={event => { setReason(event.target.value); change(); }} />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={swapHomeAway}
          onChange={event => { setSwapHomeAway(event.target.checked); setOptions(null); change(); }} />Intercambiar local y visitante</label>
        </fieldset>
        <p className="text-sm text-muted">Se revalidará el calendario completo con las restricciones vigentes. El ajuste conserva la propuesta como borrador.</p>
        {message && <p role="status" className="text-sm">{message}</p>}
        <button type="submit" disabled={pending || (options !== null && options.length === 0)} className={actionButton}>{pending ? "Validando…" : uncertain ? "Reintentar el mismo ajuste" : "Validar y guardar ajuste"}</button>
        {uncertain && <button type="button" disabled={pending} className="block text-sm underline" onClick={() => router.refresh()}>Comprobar propuesta actual</button>}
      </form>
    </FormDialog>}
  </>;
}
