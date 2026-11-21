"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { actionButton, fieldClass, sendSchedulingRequest } from "./scheduling-request";

export function AdjustmentPreview({ proposalId, matchId, expectedVersion, actorId, timeZone, initialStart }: {
  proposalId: string; matchId: string; expectedVersion: number; actorId: string; timeZone: string; initialStart: string;
}) {
  const router = useRouter();
  const venueField = useId();
  const busy = useRef(false);
  const confirmed = useRef(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [startsAt, setStartsAt] = useState(initialStart);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [venueId, setVenueId] = useState("");
  const [reason, setReason] = useState("");
  const [venues, setVenues] = useState<{ value: string; label: string }[]>([]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || confirmed.current) return;
    const saving = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "save";
    if (uncertain && !saving) return;
    if (saving && (!venueId || reason.trim().length < 8)) {
      setMessage("Elige una cancha y escribe un motivo de al menos 8 caracteres.");
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage("");
    setNotice("");
    const context = { proposalId, matchId, expectedVersion, startsAt };
    try {
      if (saving) {
        const outcome = await sendSchedulingRequest("/api/scheduling/adjustments", actorId,
          { ...context, venueId, reason: reason.trim() }, "ADJUSTMENT_SAVED");
        if (outcome.error) {
          setMessage(outcome.error);
          if (!uncertain) setVenues([]);
          return;
        }
        confirmed.current = true;
        setUncertain(false);
        setOpen(false);
        setNotice("Ajuste guardado.");
        router.refresh();
      } else {
        setVenues([]);
        setVenueId("");
        const outcome = await sendSchedulingRequest("/api/scheduling/adjustment-preview", actorId, context, "VENUE_OPTIONS");
        if (outcome.error) setMessage(outcome.error);
        else setVenues(outcome.result.venues.map((venue: { venueId: string; name: string }) => ({
          value: venue.venueId, label: venue.name,
        })));
      }
    } catch {
      if (saving) {
        setUncertain(true);
        setMessage("No se confirmó el guardado. Actualiza la propuesta para comprobar el resultado o reintenta el mismo ajuste.");
      } else setMessage("No se pudo consultar la disponibilidad.");
    } finally {
      setPending(false);
      busy.current = false;
    }
  }

  return <>
    {notice ? <p role="status" className="text-sm">{notice}</p>
      : <button type="button" className="mt-2 rounded-xl border border-border px-3 py-2 text-sm font-medium"
        onClick={() => setOpen(true)}>{uncertain ? "Recuperar ajuste" : "Ajustar horario y cancha"}</button>}
    {open && <FormDialog open title="Ajustar horario y cancha" description="Consulta las canchas para el horario y registra el motivo del ajuste."
      pending={pending} uncertain={uncertain}
      dirty={startsAt !== initialStart || Boolean(venueId || reason)}
      onClose={closeReason => {
        setOpen(false);
        if (closeReason === "discard") {
          setStartsAt(initialStart);
          setVenueId("");
          setVenues([]);
          setReason("");
          setMessage("");
        }
      }}>
      <form onSubmit={submit} className="space-y-3">
        <fieldset disabled={pending || uncertain} className="space-y-3">
          <label className="block text-sm">
            Horario propuesto · {timeZone}
            <input name="startsAt" type="datetime-local" required value={startsAt} className={fieldClass}
              onChange={event => { setStartsAt(event.target.value); setVenues([]); setVenueId(""); setMessage(""); }} />
          </label>
          <button className={actionButton} type="submit" value="preview">Consultar canchas</button>
          {venues.length > 0 && <>
            <label htmlFor={venueField} className="block text-sm">Cancha disponible</label>
            <SelectField id={venueField} value={venueId} options={venues} onValueChange={setVenueId} disabled={pending || uncertain} />
            <label className="block text-sm">Motivo del ajuste
              <textarea className={fieldClass} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
            </label>
          </>}
        </fieldset>
        {message && <p role="alert" className="text-sm">{message}</p>}
        {venues.length > 0 && <button className={actionButton} type="submit" value="save" disabled={pending}>
          {uncertain ? "Reintentar ajuste" : "Guardar ajuste"}
        </button>}
        {message && <button type="button" className="block text-sm underline" onClick={() => router.refresh()} disabled={pending}>
          Actualizar propuesta
        </button>}
      </form>
    </FormDialog>}
  </>;
}
