"use client";

import { useId, useState } from "react";
import { SelectField } from "@/components/ui/select-field";

type Format = "SINGLE" | "HOME_AND_AWAY";
export type PlayoffSettings = { regularDeadline: string; format: { quarterfinals: Format; semifinals: Format; final: Format }; preliminaryTiebreaker: "STANDING_POSITION" | "PENALTIES"; dates?: string[]; venuePolicy?: {mode:"HOME"}|{mode:"NEUTRAL";venueIds:string[]} };
const roundOptions = [{ value: "SINGLE", label: "Partido único" }, { value: "HOME_AND_AWAY", label: "Ida y vuelta" }];
export function PlayoffFields({ initial, seasonStart, seasonEnd, venues }: { initial?: PlayoffSettings; seasonStart?: string; seasonEnd?: string; venues:{id:string;name:string;code:string;active:boolean}[] }) {
  const prefix = useId();
  const [enabled, setEnabled] = useState(Boolean(initial));
  const [venueMode,setVenueMode]=useState(initial?.venuePolicy?.mode ?? "HOME");
  const [neutralIds,setNeutralIds]=useState<string[]>(initial?.venuePolicy?.mode === "NEUTRAL" ? initial.venuePolicy.venueIds : []);
  const [values, setValues] = useState<PlayoffSettings>(initial ?? { regularDeadline: "", format: { quarterfinals: "SINGLE", semifinals: "SINGLE", final: "SINGLE" }, preliminaryTiebreaker: "PENALTIES" });
  const rounds = [["quarterfinals", "Cuartos de final", "playoffQuarterfinals"], ["semifinals", "Semifinales", "playoffSemifinals"], ["final", "Final", "playoffFinal"]] as const;
  const [dates, setDates] = useState<Record<string, string>>(() => {
    let index = 0; const result: Record<string, string> = {};
    for (const [key] of rounds) for (let leg = 1; leg <= (values.format[key] === "HOME_AND_AWAY" ? 2 : 1); leg++) result[`${key}-${leg}`] = initial?.dates?.[index++] ?? "";
    return result;
  });
  return <fieldset className="space-y-4 rounded-xl border border-border p-4">
    <legend className="px-2 font-semibold">Liguilla de ocho equipos</legend>
    <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="playoffEnabled" value="yes" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Incluir liguilla</label>
    <p className="text-sm text-muted">Se puede registrar esta configuración. La generación de llaves y partidos de liguilla todavía está en desarrollo.</p>
    {enabled && <>
      <label className="block">Fecha límite de fase regular<input className="mt-1 min-h-12 w-full rounded-xl border border-border bg-surface p-3" type="date" name="playoffDeadline" required min={seasonStart} max={seasonEnd} value={values.regularDeadline} onChange={e => setValues({ ...values, regularDeadline: e.target.value })} /></label>
      <div><label htmlFor={`${prefix}-venue-mode`} className="block">Cancha para la liguilla</label><SelectField id={`${prefix}-venue-mode`} name="playoffVenueMode" value={venueMode} options={[{value:"HOME",label:"Cancha del equipo local"},{value:"NEUTRAL",label:"Canchas neutrales"}]} searchable={false} onValueChange={value=>setVenueMode(value as "HOME"|"NEUTRAL")} /></div>
      {venueMode === "NEUTRAL" && <fieldset className="space-y-2"><legend className="font-medium">Selecciona las canchas neutrales</legend>{venues.filter(venue=>venue.active).map(venue=><label key={venue.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="playoffNeutralVenues" value={venue.id} checked={neutralIds.includes(venue.id)} onChange={event=>setNeutralIds(previous=>event.target.checked?[...previous,venue.id]:previous.filter(id=>id!==venue.id))} />{venue.name} · {venue.code}</label>)}{neutralIds.length===0 && <p className="text-sm text-muted">Selecciona al menos una cancha activa.</p>}</fieldset>}
      {rounds.map(([key, label, name]) => <div key={key}><label htmlFor={`${prefix}-${key}`} className="block">{label}</label><SelectField id={`${prefix}-${key}`} name={name} value={values.format[key]} options={roundOptions} searchable={false} onValueChange={value => setValues({ ...values, format: { ...values.format, [key]: value as Format } })} /></div>)}
      <div className="space-y-3"><p className="font-semibold">Fechas previstas para la liguilla</p><p className="text-sm text-muted">Deben ser posteriores al fin de la fase regular y estar dentro de la temporada. La disponibilidad se confirma al programar cada partido.</p>
        {rounds.flatMap(([key, label]) => Array.from({ length: values.format[key] === "HOME_AND_AWAY" ? 2 : 1 }, (_, index) => {
          const dateKey = `${key}-${index + 1}`;
          return <label key={dateKey} className="block">{label} · {values.format[key] === "SINGLE" ? "partido único" : index === 0 ? "ida" : "vuelta"}<input className="mt-1 min-h-12 w-full rounded-xl border border-border bg-surface p-3" type="date" name="playoffDates" required min={values.regularDeadline || seasonStart} max={seasonEnd} value={dates[dateKey] ?? ""} onChange={event => setDates({ ...dates, [dateKey]: event.target.value })} /></label>;
        }))}
      </div>
      <div><label htmlFor={`${prefix}-tiebreaker`} className="block">Desempate en cuartos y semifinales</label><SelectField id={`${prefix}-tiebreaker`} name="playoffTiebreaker" value={values.preliminaryTiebreaker} options={[{ value: "STANDING_POSITION", label: "Mejor posición" }, { value: "PENALTIES", label: "Penales" }]} searchable={false} onValueChange={value => setValues({ ...values, preliminaryTiebreaker: value as PlayoffSettings["preliminaryTiebreaker"] })} /></div>
      <p className="text-sm text-muted">Si ambos equipos tienen el mismo puesto, se usan penales. En la final empatada siempre se usan penales.</p>
    </>}
  </fieldset>;
}
