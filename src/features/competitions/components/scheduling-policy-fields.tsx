"use client";

import { useId, useState } from "react";
import { SelectField } from "@/components/ui/select-field";

type Venue = { id: string; name: string; code: string; active: boolean };
type Stage = { key: string; fromRound: string; toRound: string; venueIds: string[] };
type Policy = { slotStepMinutes: number; venueStages: { fromRound: number; toRound: number; venueIds: string[] }[] };
const field = "mt-1 min-h-12 w-full rounded-xl border border-border bg-surface p-3";

export function SchedulingPolicyFields({ venues, initial }: { venues: Venue[]; initial?: Policy }) {
  const id = useId();
  const [step, setStep] = useState(initial ? String(initial.slotStepMinutes) : "");
  const [stages, setStages] = useState<Stage[]>(() => initial?.venueStages.map((stage, index) => ({
    key: `initial-${index}`, fromRound: String(stage.fromRound), toRound: String(stage.toRound), venueIds: stage.venueIds,
  })) ?? []);
  const policy = { slotStepMinutes: Number(step), venueStages: stages.map(stage => ({
    fromRound: Number(stage.fromRound), toRound: Number(stage.toRound), venueIds: stage.venueIds,
  })) };
  function update(key: string, patch: Partial<Stage>) {
    setStages(previous => previous.map(stage => stage.key === key ? { ...stage, ...patch } : stage));
  }
  return <fieldset data-scheduling-policy className="space-y-4 rounded-xl border border-border p-4">
    <legend className="px-1 font-semibold">Programación de partidos</legend>
    <label className="block">Intervalo entre horarios candidatos (minutos)
      <input className={field} type="number" min={1} max={120} step={1} required value={step}
        onChange={event => setStep(event.target.value)} />
    </label>
    <p className="text-sm text-muted">El generador probará horarios con este intervalo dentro de la disponibilidad de cada cancha.</p>
    <input type="hidden" name="schedulingJson" value={JSON.stringify(policy)} />
    {stages.map((stage, index) => <section key={stage.key} className="space-y-3 rounded-xl border border-border p-4">
      <h4 className="font-semibold">Tramo {index + 1}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Desde la jornada<input className={field} type="number" min={1} step={1} required value={stage.fromRound}
          onChange={event => update(stage.key, { fromRound: event.target.value })} /></label>
        <label>Hasta la jornada<input className={field} type="number" min={1} step={1} required value={stage.toRound}
          onChange={event => update(stage.key, { toRound: event.target.value })} /></label>
      </div>
      <label htmlFor={`${id}-venue-${index}`}>Agregar cancha al tramo</label>
      <SelectField id={`${id}-venue-${index}`} value="" placeholder="Selecciona una cancha"
        options={venues.filter(venue => venue.active && !stage.venueIds.includes(venue.id))
          .map(venue => ({ value: venue.id, label: venue.name, description: venue.code }))}
        onValueChange={venueId => { if (venueId) update(stage.key, { venueIds: [...stage.venueIds, venueId] }); }} />
      {stage.venueIds.length ? <ul className="space-y-2">{stage.venueIds.map(venueId => {
        const venue = venues.find(item => item.id === venueId);
        return <li key={venueId} className="flex items-center justify-between gap-3">
          <span>{venue ? `${venue.name} · ${venue.code}${venue.active ? "" : " · Inactiva"}` : "Cancha no disponible"}</span>
          <button type="button" className="min-h-11 underline" onClick={() => update(stage.key, {
            venueIds: stage.venueIds.filter(value => value !== venueId),
          })}>Quitar</button>
        </li>;
      })}</ul> : <p className="text-sm text-muted">Agrega al menos una cancha para este tramo.</p>}
      <button type="button" className="min-h-11 underline" onClick={() => setStages(previous => previous.filter(value => value.key !== stage.key))}>Quitar tramo</button>
    </section>)}
    {stages.length < 50 && <button type="button" className="min-h-11 rounded-xl border border-border px-4"
      onClick={() => setStages(previous => [...previous, { key: crypto.randomUUID(), fromRound: "", toRound: "", venueIds: [] }])}>Agregar tramo de canchas</button>}
    <p className="text-sm text-muted">Las jornadas fuera de los tramos usan las canchas disponibles y autorizadas para cada equipo.</p>
  </fieldset>;
}
