"use client";
import {useRef,useState,type FormEvent} from "react";
import {SelectField} from "@/components/ui/select-field";
import {playerRequest} from "../player-client";
import {guardianRelationships} from "../guardian-signature";
type Review={registrationId:string;fingerprint:string;documents:{id:string;name:string;code:string;status:string}[];history:{date:string;reason:string|null;decision:string}[]};
export function DocumentReviewForm({actorId,initial}:{actorId:string;initial:Review}){
  const [view,setView]=useState(initial),[id,setId]=useState(""),[decision,setDecision]=useState(""),[reason,setReason]=useState(""),[name,setName]=useState(""),[relationship,setRelationship]=useState("");
  const [checks,setChecks]=useState({identityChecked:false,relationshipChecked:false,signatureChecked:false,authorizationChecked:false});
  const [phase,setPhase]=useState("EDITING"),[message,setMessage]=useState("");
  const lock=useRef(false),pending=useRef<unknown>(null);
  const endpoint=`/api/player-registrations/${view.registrationId}/document-review`;
  const guardian=view.documents.find(d=>d.id===id)?.code==="GUARDIAN_CONSENT";
  async function send(){if(lock.current || !pending.current)return;lock.current=true;setPhase("SENDING");
    try{await playerRequest(actorId,endpoint,pending.current);pending.current=null;setMessage("Revisión confirmada. Consulta el estado del jugador para conocer su habilitación.");setPhase("CONFIRMED");try{const next=await playerRequest(actorId,endpoint) as Review;setView(next);}catch{setMessage("Revisión confirmada. Recarga la página para actualizar el listado; no hace falta reenviar la decisión.");}}
    catch{setPhase("UNCERTAIN");setMessage("No se confirmó la revisión. Conservamos la misma operación; puedes reintentar sin duplicarla. Si cambió el expediente o perdiste permisos, consulta nuevamente la página.");}
    finally{lock.current=false;}}
  function submit(e:FormEvent){e.preventDefault();if(lock.current || phase!=="EDITING")return;pending.current={operationKey:crypto.randomUUID(),fingerprint:view.fingerprint,documentId:id,decision,reason,...checks,...(guardian?{guardianName:name,relationship}:{})};void send();}
  async function download(documentId:string){try{const value=await playerRequest(actorId,`/api/player-documents/${documentId}/download`,{}) as {downloadUrl:string};window.open(value.downloadUrl,"_blank","noopener,noreferrer");}catch{setMessage("No se pudo autorizar la consulta del documento.");}}
  return <div className="space-y-5"><p>Revisa los archivos completos antes de decidir. Para acreditar al tutor debes comprobar identidad, relación con el menor, firma y texto de autorización; una credencial escolar por sí sola no demuestra parentesco.</p>
    <ul className="space-y-3">{view.documents.map(d=><li key={d.id} className="rounded-xl border border-border p-4"><p>{d.name} · {d.status}</p><button type="button" className="underline" onClick={()=>void download(d.id)}>Abrir documento privado</button></li>)}</ul>
    <form onSubmit={submit} className="space-y-4"><fieldset disabled={phase!=="EDITING"} className="space-y-4">
      <div><label htmlFor="review-document">Documento a revisar</label><SelectField id="review-document" value={id} onValueChange={value=>{setId(value);setChecks({identityChecked:false,relationshipChecked:false,signatureChecked:false,authorizationChecked:false});setName("");setRelationship("");}} options={view.documents.map(d=>({value:d.id,label:d.name+" · "+d.status}))} required/></div>
      <div><label htmlFor="review-decision">Decisión</label><SelectField id="review-decision" value={decision} onValueChange={setDecision} options={[{value:"APPROVE",label:"Aprobar documento"},{value:"CORRECTIONS_REQUIRED",label:"Solicitar corrección"}]} required searchable={false}/></div>
      {guardian && decision==="APPROVE" && <fieldset className="space-y-3 border border-border p-4"><legend>Acreditación manual del tutor</legend>
        <label className="block">Nombre del firmante comprobado<input id="review-guardian-name" value={name} onChange={e=>setName(e.target.value)} required minLength={3} maxLength={160} className="block min-h-12 w-full rounded-xl border border-border bg-surface p-3"/></label>
        <div><label htmlFor="review-relationship">Relación comprobada</label><SelectField id="review-relationship" value={relationship} onValueChange={setRelationship} options={guardianRelationships} required searchable={false}/></div>
        {([['identityChecked','Comprobé la identidad de quien firma'],['relationshipChecked','Comprobé su relación con el menor'],['signatureChecked','Revisé la firma'],['authorizationChecked','Leí y comprobé la autorización de registro y participación']] as const).map(([key,label])=><label className="flex gap-3" key={key}><input type="checkbox" checked={checks[key]} onChange={e=>setChecks(previous=>({...previous,[key]:e.target.checked}))} required/>{label}</label>)}
      </fieldset>}
      <label className="block">Justificación y comprobaciones realizadas<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={800} required className="block min-h-28 w-full rounded-xl border border-border bg-surface p-3"/></label>
      <p className="text-sm text-muted">Describe el procedimiento o evidencia consultada. Evita copiar CURP, números de documentos o datos personales en esta justificación.</p>
      <button className="primary-action min-h-12 rounded-xl px-5 py-3" disabled={!id || !decision}>Confirmar revisión</button>
    </fieldset></form>
    {phase==="UNCERTAIN" && <button type="button" onClick={()=>void send()} className="primary-action rounded-xl p-3">Reintentar la misma operación</button>}
    {phase==="CONFIRMED" && <button type="button" onClick={()=>{setId("");setDecision("");setReason("");setPhase("EDITING");}}>Revisar otro documento</button>}
    <p role="status">{message}</p><h2 className="text-xl font-semibold">Historial</h2><ul>{view.history.map((h,i)=><li key={i}>{h.date} · {h.decision} · {h.reason}</li>)}</ul>
  </div>;
}
