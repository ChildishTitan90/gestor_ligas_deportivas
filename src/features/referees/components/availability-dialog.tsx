"use client";
import { useState } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { venueLocalTime, venueTimeToIso } from "@/features/venues/time";
import type { AvailabilityPresentation, LiveRefereeControls, RefereePresentation } from "../types";
import { OperationFields } from "./operation-fields";
export function AvailabilityDialog({ referee, interval, timezone, live, onClose }: { referee: RefereePresentation; interval?: AvailabilityPresentation; timezone:string;live:LiveRefereeControls;onClose:()=>void }) {
  const [start,setStart]=useState(interval?venueLocalTime(new Date(interval.startsAt),timezone):""), [end,setEnd]=useState(interval?venueLocalTime(new Date(interval.endsAt),timezone):""), [available,setAvailable]=useState(interval?.available??true),[error,setError]=useState("");
  return <FormDialog open title={interval?"Editar intervalo":"Añadir intervalo"} description={`${referee.name} · Fechas en ${timezone}`} dirty={!!start||!!end} pending={live.pending} uncertain={live.uncertain} onClose={onClose}
    footer={<button type="submit" form="availability-form" disabled={live.pending||live.uncertain} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50">Confirmar intervalo</button>}>
    <form id="availability-form" className="space-y-4" onSubmit={async event=>{event.preventDefault();const startsAt=venueTimeToIso(start,timezone),endsAt=venueTimeToIso(end,timezone);if(!startsAt||!endsAt||endsAt<=startsAt){setError("Revisa el intervalo y la zona. El fin debe ser posterior y las horas deben existir sin ambigüedad.");return;}if(await live.mutate({kind:"availability",refereeId:referee.id,expectedVersion:referee.version,...(interval?{intervalId:interval.id}:{}),startsAt,endsAt,available}))onClose();}}>
      <fieldset disabled={live.pending||live.uncertain} className="space-y-4"><label className="block">Inicio<input required type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} className="min-h-12 w-full rounded-xl border border-border bg-surface p-3" /></label>
      <label className="block">Fin<input required type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} className="min-h-12 w-full rounded-xl border border-border bg-surface p-3" /></label>
      <label className="block">Tipo<SelectField value={available?"available":"unavailable"} onValueChange={v=>setAvailable(v==="available")} searchable={false} options={[{value:"available",label:"Disponible"},{value:"unavailable",label:"Indisponible"}]} /></label></fieldset>
      {error&&<p role="alert" className="text-sm text-danger">{error}</p>}<OperationFields live={live}/>
    </form>
  </FormDialog>;
}
