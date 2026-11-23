"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { getRescheduleSlotsAction, rescheduleAbsentMatchAction } from "../transition-actions";
import type { RescheduleInput } from "../schemas";
import { venueLocalTime } from "@/features/venues/time";
import { ProgressSteps } from "@/features/scheduling/components/progress-steps";

const messages:Record<string,string>={FORBIDDEN:"No tienes autorización vigente para reprogramar este partido.",
  STALE_MATCH:"El partido cambió. Consulta su versión vigente antes de reprogramar.",
  INVALID_LOCAL_TIME:"La fecha u hora no es válida para la zona de la liga.",INVALID_RESCHEDULE_DATE:"Elige una fecha futura dentro de la temporada; en caso de incomparecencia debe ser posterior al encuentro anterior.",
  VENUE_NOT_AVAILABLE:"La cancha no está disponible o autorizada para ese horario.",VENUE_STAGE:"El reglamento no permite esta cancha en la jornada.",
  RESERVATION_CONFLICT:"La cancha o uno de los equipos ya tiene otra reserva en ese horario.",
  SEASON_BREAK:"La fecha coincide con un descanso de temporada.",TEAM_SUSPENDED:"Un equipo tiene una restricción de participación para ese horario.",
  BOTH_ABSENT_REQUIRED:"Este flujo solo aplica cuando ambos equipos no se presentaron.",
  MATCH_REPORT_EXISTS:"El partido ya tiene una cédula. La liga debe revisar el caso antes de reprogramarlo.",
  MATCH_RESULT_EXISTS:"El partido ya tiene un resultado registrado y no puede reprogramarse desde aquí.",
  RESCHEDULE_UNCHANGED:"Selecciona una cancha o un horario diferente al actual.",
  RESCHEDULE_STATE_INVALID:"El estado actual no permite reprogramar este partido.",
  REFEREE_REASSIGN_REQUIRED:"Pide a la comisión de arbitraje revocar la designación anterior; después podrá asignar al árbitro para la nueva fecha.",
  IDEMPOTENCY_CONFLICT:"La solicitud no coincide con la operación registrada.",CONCURRENT_CHANGE:"Hubo un cambio simultáneo. Consulta el partido antes de volver a intentar."};

export function RescheduleControl({matchId,matchLabel,initial=false,version,timezone,venues,venueId:currentVenue,startsAt,proposalId,hasUpdatedPdf}:{matchId:string;matchLabel:string;initial?:boolean;version:number;timezone:string;venues:{value:string;label:string}[];venueId:string|null;startsAt:string|null;proposalId?:string|null;hasUpdatedPdf?:boolean}) {
  const router=useRouter(),sending=useRef(false);
  const [open,setOpen]=useState(false),[venueId,setVenue]=useState(currentVenue??""),[startsAtLocal,setStarts]=useState(startsAt?venueLocalTime(new Date(startsAt),timezone).slice(0,16):""),[reason,setReason]=useState("");
  const [message,setMessage]=useState(""),[uncertain,setUncertain]=useState(false),[request,setRequest]=useState<RescheduleInput|null>(null);
  const [savedPdfVersion,setSavedPdfVersion]=useState<number|null>(null);
  const [saved,setSaved]=useState(false);
  const [date,setDate]=useState(startsAt?venueLocalTime(new Date(startsAt),timezone).slice(0,10):"");
  const [slots,setSlots]=useState<{value:string;label:string}[]>([]),[loadingSlots,setLoadingSlots]=useState(false),[slotError,setSlotError]=useState("");
  const [pending,startTransition]=useTransition();
  useEffect(()=>{
    if(!open || !date || !venueId || uncertain) return;
    let active=true;
    getRescheduleSlotsAction({matchId,venueId,date,expectedVersion:version}).then(result=>{
      if(!active)return;
      if(result.ok) {setSlots(result.slots);setSlotError("");}
      else {setSlots([]);setSlotError(messages[result.code]??"No se pudieron consultar los horarios. Vuelve a intentarlo.");}
      setLoadingSlots(false);
    }).catch(()=>{if(active){setSlots([]);setSlotError("No se pudieron consultar los horarios. Vuelve a intentarlo.");setLoadingSlots(false);}});
    return ()=>{active=false;};
  },[open,date,venueId,version,matchId,uncertain]);
  useEffect(()=>{if(!uncertain)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[uncertain]);
  function send(input:RescheduleInput) {
    if(sending.current)return;sending.current=true;setMessage("");
    startTransition(async()=>{try{
      const result=await rescheduleAbsentMatchAction(input);
      if(result.ok){setRequest(null);setUncertain(false);setSaved(true);setSavedPdfVersion(result.pdfVersion??null);setReason("");setMessage(initial?"Partido programado. Revisa la designación arbitral antes de confirmarlo.":"Partido reprogramado. Revisa y confirma la designación arbitral antes de confirmarlo.");router.refresh();}
      else if(result.code==="UNAVAILABLE"){setUncertain(true);setMessage("No se recibió un resultado. Reintenta la misma solicitud.");}
      else{setRequest(null);setUncertain(false);setMessage(messages[result.code]??"No se pudo reprogramar. Revisa la disponibilidad y vuelve a consultar.");}
    }catch{setUncertain(true);setMessage("No se recibió un resultado. Reintenta la misma solicitud.");}finally{sending.current=false;}});
  }
  function submit(event:React.FormEvent){event.preventDefault();if(pending||uncertain||loadingSlots||!venueId||!slots.some(s=>s.value===startsAtLocal)||reason.trim().length<5)return;
    const input={matchId,operationId:crypto.randomUUID(),expectedVersion:version,venueId,startsAtLocal,reason:reason.trim()};setRequest(input);send(input);}
  return <div className="space-y-2"><button type="button" className="min-h-12 rounded-xl border border-border px-4 font-semibold" onClick={()=>{if(!uncertain && date && venueId)setLoadingSlots(true);setOpen(true);}}>{uncertain?"Continuar reprogramación":"Reprogramar partido"}</button>{!open&&message&&<p role="status">{message}</p>}
    <FormDialog open={open} title="Reprogramar partido" description={`${matchLabel} · Horario de la liga (${timezone}).`} dirty={venueId!==(currentVenue??"")||startsAtLocal!==(startsAt?venueLocalTime(new Date(startsAt),timezone).slice(0,16):"")||!!reason} pending={pending} uncertain={uncertain} onClose={()=>setOpen(false)}>
      <form onSubmit={submit} className="space-y-4"><p role="status">{message}</p>
        <ProgressSteps label="Tu recorrido" current={saved ? 2 : pending || uncertain ? 1 : 0} steps={[{label:"Datos del partido",detail:"Elige cancha, fecha y motivo."},{label:"Validación",detail:"Se comprueban disponibilidad y permisos."},{label:"Cambio guardado",detail:"Consulta la programación actualizada."}]}/>
        <label htmlFor={`venue-${matchId}`} className="block font-medium">Cancha</label><SelectField id={`venue-${matchId}`} value={venueId} onValueChange={value=>{setSaved(false);setVenue(value);setStarts("");setSlots([]);setSlotError("");setLoadingSlots(Boolean(value && date));}} disabled={pending||uncertain} options={venues}/>
        <label className="block font-medium">Nueva fecha<input type="date" required value={date} onChange={event=>{setSaved(false);setDate(event.target.value);setStarts("");setSlots([]);setSlotError("");setLoadingSlots(Boolean(event.target.value && venueId));}} disabled={pending||uncertain} className="mt-2 block w-full rounded-xl border border-border bg-surface p-3"/></label>
        <label htmlFor={`time-${matchId}`} className="block font-medium">Horario disponible</label><SelectField id={`time-${matchId}`} value={slots.some(s=>s.value===startsAtLocal)?startsAtLocal:""} onValueChange={value=>{setSaved(false);setStarts(value);}} disabled={pending||uncertain||loadingSlots||!date||!venueId||!slots.length} options={slots} placeholder={loadingSlots?"Buscando horarios…":"Selecciona un horario"}/>
        <p role="status" className="text-sm text-muted">{slotError || (loadingSlots ? "Buscando horarios disponibles…" : date && venueId && !slots.length ? "No hay horarios disponibles en intervalos de 30 minutos para esta fecha y cancha. Prueba otra fecha o cancha." : "Se muestran horarios cada 30 minutos; se vuelven a comprobar al guardar.")}</p>
        <label className="block font-medium">Motivo<textarea required minLength={5} maxLength={500} value={reason} onChange={event=>{setSaved(false);setReason(event.target.value);}} disabled={pending||uncertain} className="mt-2 block w-full rounded-xl border border-border bg-surface p-3"/></label>
        <p className="text-sm text-muted">Se comprobarán la autorización, la disponibilidad y las reservas. Si hay una designación arbitral aprobada, la comisión debe revocarla antes de continuar.</p>
        {proposalId && (hasUpdatedPdf || savedPdfVersion) && <a className="secondary-action inline-flex min-h-12 items-center rounded-xl border border-border px-4 font-semibold" href={`/api/scheduling/proposals/${proposalId}/updated-pdf`} download>Descargar programación actualizada{savedPdfVersion ? ` · versión ${savedPdfVersion}` : ""}</a>}
        {uncertain&&request?<button type="button" disabled={pending} className="primary-action min-h-12 rounded-xl px-4" onClick={()=>send(request)}>Reintentar la misma solicitud</button>
          :<button disabled={pending||loadingSlots||!slots.some(s=>s.value===startsAtLocal)||reason.trim().length<5} className="primary-action min-h-12 rounded-xl px-4">{pending?"Guardando…":"Confirmar reprogramación"}</button>}
      </form>
    </FormDialog>
  </div>;
}
