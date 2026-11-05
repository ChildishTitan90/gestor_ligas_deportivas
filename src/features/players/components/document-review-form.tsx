"use client";
import {PrivateDocumentPreview,type DocumentPreviewRequest} from "./private-document-preview";
import {z} from "zod";
import {useRef,useState,type FormEvent} from "react";
import {SelectField} from "@/components/ui/select-field";
import {playerRequest} from "../player-client";
import {guardianRelationships} from "../guardian-signature";
type Review={registrationId:string;fingerprint:string;documents:{id:string;name:string;code:string;status:string;identityVerified?:boolean}[];history:{date:string;reason:string|null;decision:string}[]};
const reviewSchema=z.object({registrationId:z.uuid(),fingerprint:z.string(),documents:z.array(z.object({id:z.uuid(),name:z.string(),code:z.string(),status:z.string(),identityVerified:z.boolean().optional()})),history:z.array(z.object({date:z.string(),reason:z.string().nullable(),decision:z.string()}))});
const statusLabel=(value:string)=>({PENDING:"Pendiente de revisión",VALIDATED:"Aprobado",REJECTED:"Corrección solicitada",APPROVE:"Documento aprobado",CORRECTIONS_REQUIRED:"Corrección solicitada"} as Record<string,string>)[value] ?? "Estado por consultar";
export function DocumentReviewForm({actorId,initial}:{actorId:string;initial:Review}){
  const [view,setView]=useState(initial),[id,setId]=useState(""),[decision,setDecision]=useState(""),[reason,setReason]=useState(""),[name,setName]=useState(""),[relationship,setRelationship]=useState("");
  const [checks,setChecks]=useState({identityChecked:false,relationshipChecked:false,signatureChecked:false,authorizationChecked:false});
  const [phase,setPhase]=useState("EDITING"),[message,setMessage]=useState("");
  const lock=useRef(false),pending=useRef<unknown>(null);
  const [preview,setPreview]=useState<DocumentPreviewRequest|null>(null);
  const endpoint=`/api/player-registrations/${view.registrationId}/document-review`;
  const guardian=view.documents.find(d=>d.id===id)?.code==="GUARDIAN_CONSENT";
  function clearCapture(){setId("");setDecision("");setReason("");setName("");setRelationship("");setChecks({identityChecked:false,relationshipChecked:false,signatureChecked:false,authorizationChecked:false});}
  async function refresh(){const next=reviewSchema.parse(await playerRequest(actorId,endpoint));if(next.registrationId!==view.registrationId)throw Error();setView(next);setPhase("EDITING");}
  async function send(){if(lock.current || !pending.current)return;lock.current=true;setPhase("SENDING");
    try{z.object({confirmed:z.literal(true),replayed:z.boolean()}).parse(await playerRequest(actorId,endpoint,pending.current));pending.current=null;clearCapture();setMessage("Revisión confirmada. Consulta el estado del jugador para conocer su habilitación.");setPhase("CONFIRMED");try{await refresh();}catch{setMessage("Revisión confirmada. Recarga la página para actualizar el listado; no hace falta reenviar la decisión.");}}
    catch{setPhase("UNCERTAIN");setMessage("No se confirmó la revisión. Conservamos la misma operación; puedes reintentar sin duplicarla. Si cambió el expediente o perdiste permisos, consulta nuevamente la página.");}
    finally{lock.current=false;}}
  async function consult(){if(lock.current)return;lock.current=true;try{await refresh();setMessage("Documentos actualizados. Puedes registrar otra revisión.");}catch{setMessage("La revisión ya fue confirmada, pero no se pudo actualizar el listado. Puedes volver a consultarlo sin reenviar la decisión.");}finally{lock.current=false;}}
  function submit(e:FormEvent){e.preventDefault();if(lock.current || phase!=="EDITING")return;pending.current={operationKey:crypto.randomUUID(),fingerprint:view.fingerprint,documentId:id,decision,reason,...checks,...(guardian?{guardianName:name,relationship}:{})};void send();}
  function download(documentId:string){setPreview({label:view.documents.find(d=>d.id===documentId)?.name ?? "Documento",path:`/api/player-documents/${documentId}/download`,body:{}});}
  return <div className="space-y-6">{preview && <PrivateDocumentPreview actorId={actorId} request={preview} onClose={()=>setPreview(null)}/>}<p className="text-pretty leading-7 text-muted">Abre el documento, revisa que sea legible y corresponda al jugador. Después selecciónalo para aprobarlo o pedir una corrección con un motivo claro.</p>
    <section className="space-y-3" aria-label="Documentos recibidos"><h2 className="text-xl font-semibold">Archivos del expediente</h2>{!view.documents.length && <p className="rounded-xl border border-border p-5">Todavía no hay documentos vigentes para revisar.</p>}<ul className="space-y-3">{view.documents.map(d=><li key={d.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5"><div><p className="font-semibold">{d.name}</p><p className="mt-1 text-sm text-muted">{d.identityVerified?"Identidad validada automáticamente · Solo consulta":statusLabel(d.status)}</p></div><button type="button" className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold" onClick={()=>void download(d.id)}>Abrir documento privado</button></li>)}</ul></section>
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-surface p-5"><h2 className="text-xl font-semibold">Registrar revisión</h2><fieldset disabled={phase!=="EDITING"} className="space-y-4">
      <div><label htmlFor="review-document">Documento a revisar</label><SelectField id="review-document" value={id} onValueChange={value=>{setId(value);setChecks({identityChecked:false,relationshipChecked:false,signatureChecked:false,authorizationChecked:false});setName("");setRelationship("");setDecision("");}} options={view.documents.filter(d=>!d.identityVerified).map(d=>({value:d.id,label:d.name+" · "+statusLabel(d.status)}))} required/></div>
      <div><label htmlFor="review-decision">Decisión</label><SelectField id="review-decision" value={decision} onValueChange={setDecision} options={[{value:"APPROVE",label:"Aprobar documento"},{value:"CORRECTIONS_REQUIRED",label:"Solicitar corrección"}]} required searchable={false}/></div>
      {guardian && decision==="APPROVE" && <fieldset className="space-y-3 border border-border p-4"><legend>Acreditación manual del tutor</legend>
        <p className="text-sm leading-6 text-muted">Comprueba quién firma, su relación con el menor y el texto autorizado. La credencial escolar identifica al menor; por sí sola no acredita parentesco.</p>
        <label className="block">Nombre del firmante comprobado<input id="review-guardian-name" value={name} onChange={e=>setName(e.target.value)} required minLength={3} maxLength={160} className="block min-h-12 w-full rounded-xl border border-border bg-surface p-3"/></label>
        <div><label htmlFor="review-relationship">Relación comprobada</label><SelectField id="review-relationship" value={relationship} onValueChange={setRelationship} options={guardianRelationships} required searchable={false}/></div>
        {([['identityChecked','Comprobé la identidad de quien firma'],['relationshipChecked','Comprobé su relación con el menor'],['signatureChecked','Revisé la firma'],['authorizationChecked','Leí y comprobé la autorización de registro y participación']] as const).map(([key,label])=><label className="flex gap-3" key={key}><input type="checkbox" checked={checks[key]} onChange={e=>setChecks(previous=>({...previous,[key]:e.target.checked}))} required/>{label}</label>)}
      </fieldset>}
      <label className="block">Justificación y comprobaciones realizadas<textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={800} required className="block min-h-28 w-full rounded-xl border border-border bg-surface p-3"/></label>
      <p className="text-sm text-muted">Describe el procedimiento o evidencia consultada. Evita copiar CURP, números de documentos o datos personales en esta justificación.</p>
      <button className="primary-action min-h-12 rounded-xl px-5 py-3" disabled={!id || !decision}>Confirmar revisión</button>
    </fieldset></form>
    {phase==="UNCERTAIN" && <button type="button" onClick={()=>void send()} className="primary-action rounded-xl p-3">Reintentar la misma operación</button>}
    {phase==="CONFIRMED" && <button type="button" className="min-h-12 rounded-xl border border-border px-4 py-3" onClick={()=>void consult()}>Actualizar documentos</button>}
    <p role="status">{message}</p><h2 className="text-xl font-semibold">Historial de revisión</h2>{!view.history.length && <p className="text-sm text-muted">Aún no se han registrado decisiones.</p>}<ul className="space-y-3">{view.history.map((h,i)=><li key={i} className="rounded-xl border border-border p-4"><p className="font-semibold">{statusLabel(h.decision)}</p><p className="mt-1 text-sm text-muted">{new Date(h.date).toLocaleString("es-MX")}</p><p className="mt-2 text-sm">{h.reason}</p></li>)}</ul>
  </div>;
}
