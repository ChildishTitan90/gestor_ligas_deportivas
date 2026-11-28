"use client";
import { useRef, useState, type FormEvent } from "react";

type Candidate = {bracketId:string;number:number;teams:string[]};
export function PlayoffPenaltiesForm({seasonId,candidate,onConfirmed}:{seasonId:string;candidate:Candidate;onConfirmed:()=>void}) {
 const [first,setFirst]=useState(""); const [second,setSecond]=useState(""); const [reason,setReason]=useState("");
 const [pending,setPending]=useState(false); const [uncertain,setUncertain]=useState(false); const [message,setMessage]=useState("");
 const saved=useRef<{seasonId:string;bracketId:string;operationId:string;firstScore:number;secondScore:number;reason:string}|null>(null);
 const busy=useRef(false);
 async function submit(event:FormEvent) {
  event.preventDefault(); if(busy.current) return;
  const a=Number(first),b=Number(second);
  if(!saved.current && (first==="" || second==="" || !Number.isInteger(a) || !Number.isInteger(b) || a<0 || b<0 || a>100 || b>100 || a===b || reason.trim().length<8)) {setMessage("Captura dos tanteos distintos y un motivo de al menos ocho caracteres.");return;}
  saved.current ??= {seasonId,bracketId:candidate.bracketId,operationId:crypto.randomUUID(),firstScore:a,secondScore:b,reason:reason.trim()};
  busy.current=true;setPending(true);setMessage("");
  try {
   const response=await fetch("/api/competitions/playoff-bracket",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"confirmPenalties",command:saved.current})});
   if(response.status>=500)throw Error("uncertain");
   const result=await response.json();
   if(!response.ok) {saved.current=null;setUncertain(false);setMessage(response.status===403?"No tienes permiso para confirmar penales.":result.code==="PENALTIES_NOT_REQUIRED"?"Esta llave no requiere penales o aún no tiene resultados oficiales completos.":"No se pudo confirmar la tanda. Actualiza el cuadro y revisa los resultados.");return;}
   if(!result.winnerId)throw Error("uncertain");
   setMessage("Tanda confirmada. El ganador avanzó en la llave.");setUncertain(false);onConfirmed();
  } catch {setUncertain(true);setMessage("No se confirmó el resultado. Reintenta la misma solicitud o actualiza el cuadro.");}
  finally {busy.current=false;setPending(false);}
 }
 return <form onSubmit={submit} className="space-y-3 rounded-xl border border-border p-4"><p className="font-semibold">Llave {candidate.number}: {candidate.teams.join(" vs. ")}</p><p className="text-sm text-muted">Registra penales solo si la llave terminó empatada y el reglamento los requiere.</p>
  <div className="grid gap-3 sm:grid-cols-2">{[[candidate.teams[0],first,setFirst],[candidate.teams[1],second,setSecond]].map(([label,value,set])=><label key={label as string} className="block">{label as string}<input className="mt-1 min-h-12 w-full rounded-xl border border-border bg-surface p-3" type="number" min="0" max="100" step="1" required value={value as string} disabled={pending||uncertain} onChange={event=>(set as (value:string)=>void)(event.target.value)} /></label>)}</div>
  <label className="block">Motivo<textarea className="mt-1 min-h-24 w-full rounded-xl border border-border bg-surface p-3" minLength={8} maxLength={500} required value={reason} disabled={pending||uncertain} onChange={event=>setReason(event.target.value)} /></label>
  <button className="primary-action min-h-12 rounded-xl px-4" disabled={pending}>{uncertain?"Reintentar misma confirmación":"Confirmar penales"}</button>{message&&<p role="status">{message}</p>}
 </form>;
}
