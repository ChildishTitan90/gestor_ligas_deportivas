"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { rescheduleAbsentMatchAction } from "../transition-actions";
import type { RescheduleInput } from "../schemas";

const messages:Record<string,string>={FORBIDDEN:"No tienes autorización vigente para reprogramar este partido.",
  STALE_MATCH:"El partido cambió. Consulta su versión vigente antes de reprogramar.",
  INVALID_LOCAL_TIME:"La fecha u hora no es válida para la zona de la liga.",INVALID_RESCHEDULE_DATE:"Elige una fecha posterior dentro de la temporada.",
  VENUE_NOT_AVAILABLE:"La cancha no está disponible o autorizada para ese horario.",VENUE_STAGE:"El reglamento no permite esta cancha en la jornada.",
  SEASON_BREAK:"La fecha coincide con un descanso de temporada.",TEAM_SUSPENDED:"Un equipo tiene una restricción de participación para ese horario.",
  BOTH_ABSENT_REQUIRED:"Este flujo solo aplica cuando ambos equipos no se presentaron.",
  REFEREE_REASSIGN_REQUIRED:"Pide a la comisión de arbitraje revocar la designación anterior; después podrá asignar al árbitro para la nueva fecha.",
  IDEMPOTENCY_CONFLICT:"La solicitud no coincide con la operación registrada.",CONCURRENT_CHANGE:"Hubo un cambio simultáneo. Consulta el partido antes de volver a intentar."};

export function RescheduleControl({matchId,version,timezone,venues}:{matchId:string;version:number;timezone:string;venues:{value:string;label:string}[]}) {
  const router=useRouter(),sending=useRef(false);
  const [open,setOpen]=useState(false),[venueId,setVenue]=useState(""),[startsAtLocal,setStarts]=useState(""),[reason,setReason]=useState("");
  const [message,setMessage]=useState(""),[uncertain,setUncertain]=useState(false),[request,setRequest]=useState<RescheduleInput|null>(null);
  const [pending,startTransition]=useTransition();
  useEffect(()=>{if(!uncertain)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[uncertain]);
  function send(input:RescheduleInput) {
    if(sending.current)return;sending.current=true;setMessage("");
    startTransition(async()=>{try{
      const result=await rescheduleAbsentMatchAction(input);
      if(result.ok){setOpen(false);setRequest(null);setUncertain(false);setMessage("Partido reprogramado. Revisa y confirma la designación arbitral antes de confirmarlo.");router.refresh();}
      else if(result.code==="UNAVAILABLE"){setUncertain(true);setMessage("No se recibió un resultado. Reintenta la misma solicitud.");}
      else{setRequest(null);setUncertain(false);setMessage(messages[result.code]??"No se pudo reprogramar. Revisa la disponibilidad y vuelve a consultar.");}
    }catch{setUncertain(true);setMessage("No se recibió un resultado. Reintenta la misma solicitud.");}finally{sending.current=false;}});
  }
  function submit(event:React.FormEvent){event.preventDefault();if(pending||uncertain||!venueId||!startsAtLocal||reason.trim().length<5)return;
    const input={matchId,operationId:crypto.randomUUID(),expectedVersion:version,venueId,startsAtLocal,reason:reason.trim()};setRequest(input);send(input);}
  return <div className="space-y-2"><button type="button" className="min-h-12 rounded-xl border border-border px-4 font-semibold" onClick={()=>setOpen(true)}>{uncertain?"Continuar reprogramación":"Reprogramar partido"}</button>{!open&&message&&<p role="status">{message}</p>}
    <FormDialog open={open} title="Reprogramar partido" description={`Selecciona la cancha y el nuevo horario de la liga (${timezone}).`} dirty={!!venueId||!!startsAtLocal||!!reason} pending={pending} uncertain={uncertain} onClose={()=>setOpen(false)}>
      <form onSubmit={submit} className="space-y-4"><p role="status">{message}</p>
        <label htmlFor={`venue-${matchId}`} className="block font-medium">Cancha</label><SelectField id={`venue-${matchId}`} value={venueId} onValueChange={setVenue} disabled={pending||uncertain} options={venues}/>
        <label className="block font-medium">Nueva fecha y hora<input type="datetime-local" required value={startsAtLocal} onChange={event=>setStarts(event.target.value)} disabled={pending||uncertain} className="mt-2 block w-full rounded-xl border border-border bg-surface p-3"/></label>
        <label className="block font-medium">Motivo<textarea required minLength={5} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} disabled={pending||uncertain} className="mt-2 block w-full rounded-xl border border-border bg-surface p-3"/></label>
        <p className="text-sm text-muted">Se comprobarán disponibilidad, permisos y reservas. La incidencia anterior permanecerá registrada.</p>
        {uncertain&&request?<button type="button" disabled={pending} className="primary-action min-h-12 rounded-xl px-4" onClick={()=>send(request)}>Reintentar la misma solicitud</button>
          :<button disabled={pending||!venueId||!startsAtLocal||reason.trim().length<5} className="primary-action min-h-12 rounded-xl px-4">{pending?"Guardando…":"Confirmar reprogramación"}</button>}
      </form>
    </FormDialog>
  </div>;
}
