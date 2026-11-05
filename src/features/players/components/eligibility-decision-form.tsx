"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {z} from "zod";
import {playerRequest,PlayerRequestError} from "../player-client";
import {participationReceiptSchema,participationMessages} from "../participation-workspace";
import type {EligibilityAssessment} from "../category-participation";

export function EligibilityDecisionForm({actorId,endpoint,assessment,version,status,allowed,origin=false}:{actorId:string;endpoint:string;assessment:EligibilityAssessment;version?:number;status:string;allowed:boolean;origin?:boolean}){
  const router=useRouter(),lock=useRef(false),intent=useRef<unknown>(null);
  const [phase,setPhase]=useState<"EDITING"|"SENDING"|"UNCERTAIN"|"CONFIRMED">("EDITING"),[reason,setReason]=useState(""),[message,setMessage]=useState("");
  useEffect(()=>{if(phase!=="SENDING" && phase!=="UNCERTAIN")return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[phase]);
  async function send(){
    if(lock.current || !intent.current)return;
    lock.current=true;setPhase("SENDING");setMessage("");
    try{
      const value=await playerRequest(actorId,endpoint,intent.current);
      const confirmed=origin?z.object({registrationId:z.uuid(),status:z.string(),replayed:z.boolean()}).safeParse(value):participationReceiptSchema.safeParse(value);
      if(!confirmed.success)throw new PlayerRequestError("UNCONFIRMED",true);
      setPhase("CONFIRMED");intent.current=null;setMessage("Decisión confirmada. Se actualizará el estado del jugador.");router.refresh();
    }catch(error){if(error instanceof PlayerRequestError && !error.uncertain){intent.current=null;setPhase("EDITING");setMessage(participationMessages[error.code] ?? "La decisión no pudo guardarse. Consulta el estado actual.");}else{setPhase("UNCERTAIN");setMessage("No se confirmó esta decisión. Conservamos la misma operación; consulta el estado o reintenta sin cambiar su contenido.");}}
    finally{lock.current=false;}
  }
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(lock.current || phase!=="EDITING" || !allowed)return;
    const decision=(event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ?? "AUTHORIZE";
    if(decision==="AUTHORIZE" && !assessment.ready)return;
    intent.current={operationKey:crypto.randomUUID(),fingerprint:assessment.fingerprint,reason,...(origin?{}:{expectedVersion:version,decision})};void send();
  }
  return <div className="space-y-3">
    {assessment.blockers.length>0 && <div className="rounded-xl border border-border bg-background p-4"><p className="font-semibold text-primary">Condiciones pendientes</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted">{assessment.blockers.map((block,index)=><li key={`${block.code}-${block.categoryId}-${index}`}>{block.message}</li>)}</ul></div>}
    {!allowed && <p className="text-sm text-muted">La decisión corresponde a una cuenta con permiso de aprobación en este contexto.</p>}
    <form onSubmit={submit} className="space-y-3" aria-label={origin?"Habilitar inscripción de origen":"Decidir participación superior"}>
      <fieldset disabled={!allowed || phase!=="EDITING"} className="space-y-3">
        <label className="block text-sm font-medium">Motivo de la decisión<textarea required minLength={10} maxLength={800} value={reason} onChange={event=>setReason(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-border bg-surface p-3" /></label>
        <div className="flex flex-wrap gap-3"><button type="submit" value="AUTHORIZE" disabled={!assessment.ready || (origin && status!=="INELIGIBLE")} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50">{phase==="SENDING"?"Confirmando…":origin?"Habilitar en categoría de origen":status==="WITHDRAWN"?"Volver a autorizar participación":"Autorizar participación superior"}</button>
          {!origin && <button type="submit" value="WITHDRAW" disabled={status==="WITHDRAWN"} className="min-h-12 rounded-xl border border-border px-5 py-3 font-semibold disabled:opacity-50">Retirar participación</button>}
        </div>
      </fieldset>
    </form>
    {message && <p role="status" className="text-sm leading-6">{message}</p>}
    {phase==="UNCERTAIN" && <div className="flex flex-wrap gap-3"><button type="button" onClick={()=>router.refresh()} className="min-h-12 rounded-xl border border-border px-4 py-3">Consultar estado actual</button><button type="button" onClick={()=>void send()} className="primary-action min-h-12 rounded-xl px-4 py-3">Reintentar la misma operación</button></div>}
  </div>;
}
