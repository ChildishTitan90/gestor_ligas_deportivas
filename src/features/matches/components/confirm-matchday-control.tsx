"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { confirmMatchdayAction } from "../transition-actions";

type Input={matchdayId:string;operationId:string;reason:string};
type Result=Extract<Awaited<ReturnType<typeof confirmMatchdayAction>>,{ok:true}>["result"];
const reasons:Record<string,string>={MAIN_REFEREE_REQUIRED:"Falta designación arbitral principal aprobada y vigente.",SCHEDULE_REQUIRED:"Falta cancha u horario válido.",STALE_MATCH:"El partido cambió; actualiza la página y vuelve a revisarlo.",FORBIDDEN:"No tienes permiso vigente para confirmar este partido.",STATE_NOT_READY:"El estado actual no permite confirmarlo.",SEASON_CLOSED:"La temporada está cerrada."};

export function ConfirmMatchdayControl({matchdayId,number}:{matchdayId:string;number:number}) {
  const [open,setOpen]=useState(false),[reason,setReason]=useState(""),[checked,setChecked]=useState(false);
  const [uncertain,setUncertain]=useState(false),[request,setRequest]=useState<Input|null>(null),[result,setResult]=useState<Result|null>(null),[error,setError]=useState("");
  const [pending,startTransition]=useTransition(),busy=useRef(false),router=useRouter();
  useEffect(()=>{if(!uncertain)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[uncertain]);
  function send(input:Input) {
    if(busy.current)return;busy.current=true;setError("");
    startTransition(async()=>{try {
      const response=await confirmMatchdayAction(input);
      if(response.ok){setResult(response.result);setUncertain(false);setRequest(null);router.refresh();}
      else if(response.code==="UNAVAILABLE"){setUncertain(true);setError("No se recibió el resultado completo. Reintenta esta misma solicitud para revisar lo que falta.");}
      else{setUncertain(false);setRequest(null);setError(reasons[response.code]??"No se pudo confirmar la jornada. Actualiza la página y vuelve a intentarlo.");}
    }catch{setUncertain(true);setError("No se recibió el resultado completo. Reintenta esta misma solicitud para revisar lo que falta.");}
    finally{busy.current=false;}});
  }
  function submit(event:React.FormEvent){event.preventDefault();if(pending||uncertain||!checked||reason.trim().length<5)return;
    const input={matchdayId,operationId:crypto.randomUUID(),reason:reason.trim()};setRequest(input);send(input);}
  function close(){setOpen(false);if(!uncertain){setReason("");setChecked(false);setRequest(null);setResult(null);setError("");}}
  return <><button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold" onClick={()=>setOpen(true)}>{uncertain?"Continuar confirmación pendiente":"Confirmar partidos de la jornada"}</button>
    <FormDialog open={open} title={`Confirmar partidos · Jornada ${number}`} description="Se confirmarán los partidos listos. Los que tengan impedimentos quedarán pendientes y se mostrarán al terminar." pending={pending} uncertain={uncertain} dirty={!result && (!!reason||checked)} onClose={close}>
      {result ? <div className="space-y-3"><p role="status">Confirmados: {result.confirmed.length} · Ya confirmados: {result.already.length} · Pendientes: {result.pending.length}</p>
        {result.pending.length>0 && <><p className="font-semibold">Partidos que necesitan atención</p><ul className="space-y-2">{result.pending.map((item,index)=><li key={`${item.name}-${index}`} className="rounded-xl border border-border p-3"><strong>{item.name}</strong><p className="text-sm">{reasons[item.code]??"No se pudo confirmar; revisa el estado y vuelve a intentarlo."}</p></li>)}</ul></>}
        <button type="button" onClick={close} className="min-h-12 rounded-xl border border-border px-4 font-semibold">Cerrar</button></div> :
      <form onSubmit={submit} className="space-y-4"><p role="status">{error}</p><label className="block font-medium">Motivo<textarea value={reason} onChange={e=>setReason(e.target.value)} disabled={pending||uncertain} minLength={5} maxLength={500} required className="mt-2 block w-full rounded-xl border border-border bg-surface p-3" /></label>
        <label className="flex gap-2"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} disabled={pending||uncertain}/> Confirmo que deseo revisar y confirmar los partidos disponibles de esta jornada.</label>
        {uncertain && request ? <button type="button" disabled={pending} onClick={()=>send(request)} className="primary-action min-h-12 rounded-xl px-4 font-semibold">Reintentar la misma solicitud</button> :
          <button disabled={pending||!checked||reason.trim().length<5} className="primary-action min-h-12 rounded-xl px-4 font-semibold disabled:opacity-50">{pending?"Comprobando partidos…":"Confirmar disponibles"}</button>}
      </form>}
    </FormDialog></>;
}
