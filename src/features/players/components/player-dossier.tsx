"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {z} from "zod";
import {SelectField} from "@/components/ui/select-field";
import {playerDossierSchema,type PlayerDossier as Dossier} from "../document-types";
import {playerRequest,PlayerRequestError} from "../player-client";
import {sendPlayerDocumentOperation,type PendingDocumentUpload} from "../document-upload.client";

const messages:Record<string,string>={CONFIGURATION_REQUIRED:"Falta configurar la política o este requisito documental.",CONTEXT_UNAVAILABLE:"El expediente ya no permite cargas en su estado actual.",UPLOAD_CONFLICT:"Los datos o la versión cambiaron. Consulta el expediente antes de preparar otra carga.",UPLOAD_EXPIRED:"La intención venció. Prepara una nueva carga después de consultar su estado.",INVALID_FILE:"El contenido del archivo no corresponde a un PNG, JPEG o PDF válido.",FILE_TOO_LARGE:"El archivo supera los 10 MiB permitidos.",FORBIDDEN:"Tu cuenta ya no tiene acceso a esta operación.",UNAUTHENTICATED:"Tu sesión ya no está disponible. Inicia sesión nuevamente."};
export function PlayerDossier({actorId,initial,storageConfigured}:{actorId:string;initial:Dossier;storageConfigured:boolean}){
  const [dossier,setDossier]=useState(initial),[requirementId,setRequirementId]=useState(""),[slot,setSlot]=useState("1"),[file,setFile]=useState<File|null>(null);
  const [phase,setPhase]=useState<"EDITING"|"SENDING"|"UNCERTAIN"|"CONFIRMED">("EDITING"),[message,setMessage]=useState("");
  const lock=useRef(false),pending=useRef<PendingDocumentUpload|null>(null),form=useRef<HTMLFormElement>(null);
  const requirement=dossier.requirements.find(r=>r.id===requirementId);
  const selectedCurrent=dossier.documents.find(d=>d.requirementId===requirementId && d.slot===Number(slot) && !d.superseded);
  const endpoint=`/api/player-registrations/${dossier.registrationId}/documents`;
  const secondary="min-h-12 rounded-xl border border-border bg-surface px-4 py-3 font-semibold text-primary disabled:opacity-50";
  const frozen=phase!=="EDITING";
  useEffect(()=>{if(!["SENDING","UNCERTAIN"].includes(phase))return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[phase]);
  async function refresh(){
    const value=await playerRequest(actorId,endpoint);
    const parsed=playerDossierSchema.safeParse(value);
    if(!parsed.success || parsed.data.registrationId!==dossier.registrationId)throw new PlayerRequestError("UNCONFIRMED",true);
    setDossier(parsed.data);
  }
  async function send(){
    const operation=pending.current;if(lock.current || !operation)return;lock.current=true;setPhase("SENDING");setMessage("");
    try{
      await sendPlayerDocumentOperation(actorId,operation);
      setPhase("CONFIRMED");setMessage("Archivo recibido y asociado al expediente. Sigue pendiente de revisión documental.");await refresh().catch(()=>setMessage("Archivo confirmado. No se pudo actualizar el listado; vuelve a consultar el expediente."));
    }catch(error){
      if(error instanceof PlayerRequestError && !error.uncertain){pending.current=null;setPhase("EDITING");setMessage(messages[error.code] ?? "La operación fue rechazada. Consulta el expediente y revisa el archivo.");}
      else{setPhase("UNCERTAIN");setMessage("No se pudo confirmar el resultado. Conservamos la misma intención y el archivo en esta pantalla. Consulta el acuse antes de reintentar.");}
    }finally{lock.current=false;}
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(lock.current || frozen || !requirement || !file)return;
    if(!["application/pdf","image/png","image/jpeg"].includes(file.type) || !file.size || file.size>10485760){setMessage("Selecciona un PNG, JPEG o PDF de hasta 10 MiB. El servidor también comprobará su contenido.");return;}
    lock.current=true;setPhase("SENDING");
    try{const bytes=new Uint8Array(await file.arrayBuffer());const hash=await crypto.subtle.digest("SHA-256",bytes);
      const sha256=Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,"0")).join("");
      pending.current={bytes,mimeType:file.type,step:"PREPARE",body:{operationKey:crypto.randomUUID(),registrationId:dossier.registrationId,requirementId,slot:Number(slot),replacesDocumentId:selectedCurrent?.id ?? null,mimeType:file.type,sizeBytes:file.size,sha256}};
    }catch{setPhase("EDITING");setMessage("No se pudo leer el archivo. Selecciónalo nuevamente.");}
    finally{lock.current=false;}
    if(pending.current)await send();
  }
  async function recover(){
    const operation=pending.current;if(lock.current || !operation)return;
    if(!operation.uploadPath){setMessage("No llegó el identificador de la intención. Reintentar el mismo envío recuperará la preparación sin crear otra intención.");return;}
    lock.current=true;
    try{const result=z.object({state:z.enum(["CONFIRMED","PENDING_STORAGE","EXPIRED_UNCONFIRMED"])}).parse(await playerRequest(actorId,operation.uploadPath));
      if(result.state==="CONFIRMED"){setPhase("CONFIRMED");setMessage("Recepción confirmada. Esta consulta no volvió a cargar el archivo.");await refresh().catch(()=>setMessage("Recepción confirmada. Vuelve a consultar el expediente para actualizar el listado."));}
      else if(result.state==="PENDING_STORAGE")setMessage("La asociación aún no está confirmada. Puedes reintentar la misma intención; el servidor verificará cualquier objeto existente.");
      else{pending.current=null;setPhase("EDITING");setMessage("La intención venció sin asociación confirmada. Puedes preparar un nuevo envío con el archivo seleccionado; no se borró ningún objeto anterior.");await refresh().catch(()=>undefined);}
    }catch{setMessage("No se pudo consultar el acuse. Conserva la misma intención y vuelve a consultar.");}finally{lock.current=false;}
  }
  async function download(id:string){
    if(lock.current)return;lock.current=true;
    try{const result=z.object({downloadUrl:z.string().url()}).parse(await playerRequest(actorId,`/api/player-documents/${id}/download`,{}));window.location.assign(result.downloadUrl);}
    catch{setMessage("No se pudo autorizar la descarga. Comprueba tu sesión y vuelve a consultar el expediente.");}finally{lock.current=false;}
  }
  return <div className="space-y-7">
    <div className="rounded-xl border border-border bg-surface p-5 space-y-2"><p>Edad evaluada en el registro del {dossier.referenceDate}: {dossier.minorAtRegistration===null?"fecha de nacimiento pendiente":dossier.minorAtRegistration?"menor de edad":"mayor de edad"}.</p>
      <p className="text-sm text-muted">Las cargas y sustituciones se permiten cualquier día mientras el expediente esté pendiente. Recibir archivos no autoriza al jugador para competir.</p>
      {dossier.minorAtRegistration && <p>La autorización del tutor requiere acreditación y revisión. La credencial estudiantil es opcional y no la sustituye.</p>}
    </div>
    <section className="space-y-3" aria-label="Requisitos documentales"><h2 className="text-xl font-semibold">Requisitos del expediente</h2>
      {(dossier.configuration==="MISSING" || dossier.configurationIssues.length>0) && <p role="status" className="rounded-xl border border-border p-4">La configuración documental está incompleta o requiere corrección por administración. El expediente no puede aprobarse.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">{dossier.requirements.map(r=><li key={r.id} className="rounded-xl border border-border bg-surface p-4"><p className="font-semibold">{dossier.documentTypes.find(t=>t.id===r.typeId)?.name} · {r.required?"Obligatorio":"Opcional"}</p><p className="mt-2 text-sm">Recibidos vigentes: {r.recorded} de {r.quantity} · Revisados: {r.approved}{r.required?` · Faltantes: ${r.missing}`:""}</p></li>)}</ul>
    </section>
    <form ref={form} onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-surface p-5" aria-label="Cargar documento">
      <h2 className="text-xl font-semibold">Adjuntar documento</h2>
      {!storageConfigured && <p role="status">El almacenamiento privado no está configurado.</p>}
      {!dossier.canUpload && <p role="status">El estado del expediente no permite nuevas cargas.</p>}
      <fieldset disabled={frozen || !storageConfigured || !dossier.canUpload} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Archivo y requisito</legend>
        <div><label htmlFor="document-requirement">Documento</label><SelectField id="document-requirement" name="requirementId" value={requirementId} onValueChange={value=>{setRequirementId(value);setSlot("1");}} options={dossier.requirements.map(r=>({value:r.id,label:dossier.documentTypes.find(t=>t.id===r.typeId)?.name ?? "Documento",disabled:dossier.documentTypes.find(t=>t.id===r.typeId)?.code==="STUDENT_ID" && r.required}))} required /></div>
        <div><label htmlFor="document-slot">Posición del requisito</label><SelectField id="document-slot" name="slot" value={slot} onValueChange={setSlot} disabled={!requirement} searchable={false} options={Array.from({length:requirement?.quantity ?? 0},(_,i)=>({value:String(i+1),label:`Archivo ${i+1}`}))} required /></div>
        <div><label htmlFor="document-file">Archivo del dispositivo</label><input id="document-file" type="file" accept="application/pdf,image/jpeg,image/png" aria-describedby="dossier-file-help dossier-upload-message" className="mt-2 block w-full" onChange={event=>setFile(event.target.files?.[0] ?? null)} /></div>
        <div><label htmlFor="document-camera">Tomar una foto (si está disponible)</label><input id="document-camera" type="file" accept="image/jpeg,image/png" capture="environment" aria-describedby="dossier-file-help dossier-upload-message" className="mt-2 block w-full" onChange={event=>setFile(event.target.files?.[0] ?? null)} /></div>
      </fieldset>
      {file && <p className="break-all text-sm">Seleccionado: {file.name} · {Math.ceil(file.size/1024)} KiB</p>}
      {selectedCurrent && <p className="text-sm">Esta carga sustituirá la versión vigente. La versión anterior se conservará y la nueva necesitará revisión.</p>}
      <div className="flex flex-wrap gap-3">
        {phase==="EDITING" && <button className="primary-action min-h-12 rounded-xl px-5 py-3 disabled:opacity-50" disabled={!file || !requirement || !storageConfigured || !dossier.canUpload}>Cargar y confirmar archivo</button>}
        {phase==="SENDING" && <button type="button" disabled className={secondary}>Procesando…</button>}
        {phase==="UNCERTAIN" && <><button type="button" className={secondary} onClick={()=>void recover()}>Consultar acuse</button><button type="button" className={secondary} onClick={()=>void send()}>Reintentar la misma intención</button></>}
        {phase==="CONFIRMED" && <button type="button" className={secondary} onClick={()=>{pending.current=null;setFile(null);form.current?.reset();setPhase("EDITING");setMessage("");}}>Adjuntar otro archivo</button>}
      </div>
      <p id="dossier-upload-message" role="status" className={message?"rounded-xl border border-border p-4 text-sm leading-6":"sr-only"}>{message}</p>
      <p id="dossier-file-help" className="text-xs leading-6 text-muted">PNG, JPEG o PDF de hasta 10 MiB. El archivo solo se conserva en esta pantalla; al salir o recargar tendrás que seleccionarlo otra vez. Una fotografía no demuestra por sí sola la originalidad del documento.</p>
    </form>
    <section className="space-y-3" aria-label="Archivos del expediente"><h2 className="text-xl font-semibold">Archivos recibidos e historial</h2>
      {!dossier.documents.length && <p>No se han recibido archivos.</p>}
      <ul className="space-y-3">{dossier.documents.map(doc=><li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4"><div><p>{dossier.documentTypes.find(t=>t.id===doc.typeId)?.name ?? "Documento histórico"}{doc.slot?` · Archivo ${doc.slot}`:""}</p><p className="mt-1 text-sm text-muted">{doc.superseded?"Versión anterior":doc.storageConfirmation!=="CONFIRMED"?"Confirmación pendiente de reconciliación":doc.reviewStatus==="VALIDATED"?"Revisado":doc.reviewStatus==="REJECTED"?"Requiere corrección":"Recibido · Pendiente de revisión"}</p></div><button type="button" disabled={phase==="SENDING" || phase==="UNCERTAIN" || doc.storageConfirmation!=="CONFIRMED"} onClick={()=>void download(doc.id)} className={secondary}>Descargar copia privada</button></li>)}</ul>
    </section>
  </div>;
}
