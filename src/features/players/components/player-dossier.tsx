"use client";
import {PrivateDocumentPreview,type DocumentPreviewRequest} from "./private-document-preview";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {z} from "zod";
import {SelectField} from "@/components/ui/select-field";
import {FilePickerButton} from "@/components/ui/file-picker-button";
import {focusFormControl} from "@/components/ui/focus-form-control";
import {documentGroupLabels} from "@/features/competitions/document-policy-editor";
import {Check,FileText} from "lucide-react";
import {playerDossierSchema,type PlayerDossier as Dossier} from "../document-types";
import {playerRequest,PlayerRequestError} from "../player-client";
import {sendPlayerDocumentOperation,type PendingDocumentUpload} from "../document-upload.client";
import {DevicePhotoCamera} from "./device-photo-camera";
import {GuardianSignatureCapture} from "./guardian-signature-capture";

function LocalDocumentPreview({file}:{file:File}){
  const image=useRef<HTMLImageElement>(null),pdf=useRef<HTMLAnchorElement>(null);
  useEffect(()=>{const url=URL.createObjectURL(file);if(image.current)image.current.src=url;if(pdf.current)pdf.current.href=url;return()=>URL.revokeObjectURL(url);},[file]);
  if(file.type==="application/pdf")return <a ref={pdf} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-border px-4 py-3 font-semibold text-primary"><FileText aria-hidden="true" size={20}/>Abrir vista previa del PDF</a>;
  // eslint-disable-next-line @next/next/no-img-element -- Vista previa local, sin optimizador ni envío de la foto.
  return <img ref={image} alt="Vista previa del archivo seleccionado" className="max-h-64 max-w-full rounded-xl border border-border object-contain"/>;
}

const messages:Record<string,string>={CONFIGURATION_REQUIRED:"Falta configurar la política o este requisito documental.",CONTEXT_UNAVAILABLE:"El expediente ya no permite cargas en su estado actual.",UPLOAD_CONFLICT:"Los datos o la versión cambiaron. Consulta el expediente antes de preparar otra carga.",UPLOAD_EXPIRED:"La intención venció. Prepara una nueva carga después de consultar su estado.",INVALID_FILE:"El contenido del archivo no corresponde a un PNG, JPEG o PDF válido.",FILE_TOO_LARGE:"El archivo supera los 10 MiB permitidos.",FORBIDDEN:"Tu cuenta ya no tiene acceso a esta operación.",UNAUTHENTICATED:"Tu sesión ya no está disponible. Inicia sesión nuevamente."};
export function PlayerDossier({actorId,initial,storageConfigured}:{actorId:string;initial:Dossier;storageConfigured:boolean}){
  const [dossier,setDossier]=useState(initial),[requirementId,setRequirementId]=useState(""),[slot,setSlot]=useState("1"),[file,setFile]=useState<File|null>(null);
  const [phase,setPhase]=useState<"EDITING"|"SENDING"|"UNCERTAIN"|"CONFIRMED">("EDITING"),[message,setMessage]=useState("");
  const [cameraVersion,setCameraVersion]=useState(0);
  const lock=useRef(false),pending=useRef<PendingDocumentUpload|null>(null),form=useRef<HTMLFormElement>(null);
  const [preview,setPreview]=useState<DocumentPreviewRequest|null>(null);
  const requirement=dossier.requirements.find(r=>r.id===requirementId);
  const documentName=dossier.documentTypes.find(t=>t.id===requirement?.typeId)?.name ?? "Documento";
  const photo=dossier.documentTypes.find(t=>t.id===requirement?.typeId)?.code==="PHOTO";
  const guardian=(dossier.minorDocumentFlow ?? dossier.minorAtRegistration)===true && dossier.documentTypes.find(t=>t.id===requirement?.typeId)?.code==="GUARDIAN_CONSENT";
  const selectedCurrent=dossier.documents.find(d=>d.requirementId===requirementId && d.slot===Number(slot) && !d.superseded);
  const endpoint=`/api/player-registrations/${dossier.registrationId}/documents`;
  const secondary="min-h-12 rounded-xl border border-border bg-surface px-4 py-3 font-semibold text-primary disabled:opacity-50";
  const frozen=phase!=="EDITING";
  function selectFile(next:File|null){
    if(lock.current || frozen)return;
    setCameraVersion(value=>value+1);setMessage("");
    if(next && (!(photo?["image/png","image/jpeg"]:["application/pdf","image/png","image/jpeg"]).includes(next.type) || !next.size || next.size>10485760)){
      setFile(null);setMessage(photo?"Elige una foto PNG o JPEG de hasta 10 MiB.":"Elige un archivo PNG, JPEG o PDF de hasta 10 MiB.");return;
    }
    setFile(next);
  }
  function selectRequirement(id:string,focus=false){
    if(lock.current || frozen)return;
    setRequirementId(id);setSlot("1");setFile(null);setMessage("");setCameraVersion(value=>value+1);
    if(focus)requestAnimationFrame(()=>{form.current?.scrollIntoView({block:"start"});if(form.current)focusFormControl(form.current,"requirementId");});
  }
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
    if(!(photo?["image/png","image/jpeg"]:["application/pdf","image/png","image/jpeg"]).includes(file.type) || !file.size || file.size>10485760){setMessage(photo?"Selecciona una foto PNG o JPEG de hasta 10 MiB.":"Selecciona un PNG, JPEG o PDF de hasta 10 MiB. El servidor también comprobará su contenido.");return;}
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
  function download(id:string){const doc=dossier.documents.find(d=>d.id===id);setPreview({label:dossier.documentTypes.find(t=>t.id===doc?.typeId)?.name ?? "Documento del expediente",path:`/api/player-documents/${id}/download`,body:{}});}
  return <div className="space-y-7">{preview && <PrivateDocumentPreview actorId={actorId} request={preview} onClose={()=>setPreview(null)}/>}
    {dossier.documentGroups?.some(g=>g.scope==="SUPERIOR") && <section className="space-y-3 rounded-xl border border-border bg-surface p-5"><h2 className="text-xl font-semibold">Requisitos por categoría</h2><p className="text-sm text-muted">Un solo expediente conserva los archivos de origen y de las participaciones superiores. Un documento aprobado puede satisfacer requisitos compatibles en ambas.</p><ul className="space-y-2">{dossier.documentGroups.filter(g=>g.requiredForDossier || g.requiredForEligibility).map((g,i)=><li key={i} className="text-sm leading-6"><strong>{g.categoryName} · {g.scope==="ORIGIN"?"Origen":"Superior"}</strong>: {documentGroupLabels[g.key as keyof typeof documentGroupLabels] ?? "Documento"} · {g.ready?"Cumplido":"Pendiente de aprobación"}{g.requiredForEligibility?" · Requerido para habilitación":" · Para completar expediente"}</li>)}</ul></section>}
    <div className="rounded-xl border border-border bg-surface p-5 space-y-2"><p>Edad evaluada en el registro del {dossier.referenceDate}: {dossier.minorAtRegistration===null?"fecha de nacimiento pendiente":dossier.minorAtRegistration?"menor de edad":"mayor de edad"}.</p>
      <p className="text-sm text-muted">{dossier.registrationStatus==="ACTIVE"?(dossier.canUpload?"Jugador activo. Puedes completar los documentos pendientes mientras el expediente siga abierto; las cargas no cambian su habilitación.":"Jugador activo. El estado actual del expediente no permite nuevas cargas."):"Las cargas y sustituciones se permiten cualquier día mientras el expediente esté pendiente. Recibir archivos no autoriza al jugador para competir."}</p>
      {(dossier.minorDocumentFlow ?? dossier.minorAtRegistration) && <p>La firma del padre, madre o tutor requiere acreditación y revisión. La credencial escolar o constancia de estudios corresponde al menor y se revisa por separado.</p>}
      {(dossier.minorDocumentFlow ?? dossier.minorAtRegistration) && <p role="status">Autorización del tutor: {dossier.guardianConsent==="ACCREDITED"?"acreditada por revisión administrativa":"pendiente de acreditación"}.</p>}
      {dossier.dossierComplete && <p role="status">Expediente documental completo y revisado. La habilitación deportiva se consulta por separado.</p>}
      <p className="text-sm text-muted">Puedes añadir o sustituir la foto del jugador en este expediente mientras esté pendiente. Es distinta de la selfie de verificación de Veteranos y no bloquea el alta inicial.</p>
    </div>
    {dossier.identityVerification?.curpVerified && <p role="status" className="rounded-xl border border-border p-4">CURP verificada en RENAPO y coincidente con el jugador. No requiere otra revisión de identidad. Esta consulta no incluye la constancia PDF; si la política solicita el archivo, puedes adjuntarlo al expediente.</p>}
    <section className="space-y-3" aria-label="Requisitos documentales"><h2 className="text-xl font-semibold">Requisitos del expediente</h2>
      {dossier.school?.required && <p role="status" className="rounded-xl border border-border p-4">Documento escolar obligatorio: entrega una credencial escolar <strong>o</strong> una constancia de estudios. Basta una de las dos. Estado: {dossier.school.approved?"revisado y aprobado":dossier.school.received?"recibido, pendiente de revisión":"faltante"}.</p>}
      {(dossier.configuration==="MISSING" || dossier.configurationIssues.length>0) && <p role="status" className="rounded-xl border border-border p-4">La configuración documental está incompleta o requiere corrección por administración. El expediente no puede darse por completo.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">{dossier.requirements.map(r=>{
        const type=dossier.documentTypes.find(t=>t.id===r.typeId),chosen=requirementId===r.id;
        const verifiedIne=type?.code==="INE" && r.quantity===1 && dossier.identityVerification?.ineAttemptId;
        const current=dossier.documents.some(d=>d.requirementId===r.id && !d.superseded);
        return <li key={r.id} className={`space-y-3 rounded-xl border bg-surface p-4 ${chosen?"border-accent":"border-border"}`}>
          <p className="font-semibold">{type?.name} · {["STUDENT_ID","STUDENT_CERTIFICATE"].includes(type?.code ?? "")?"Alternativa escolar":dossier.documentGroups?.some(g=>g.requiredForDossier && g.typeIds.length>1 && g.typeIds.includes(r.typeId))?"Alternativa obligatoria":r.required?"Obligatorio para el expediente":"Opcional"}</p>
          <p className="text-sm">{verifiedIne?"Identificación validada automáticamente · No requiere otra carga ni revisión":r.quantity===1?(r.approved?"Revisado y aprobado":r.recorded?"Recibido · Pendiente de revisión":current?"Requiere corrección":"Sin adjuntar"):`Recibidos: ${r.recorded} de ${r.quantity} · Revisados: ${r.approved}`}</p>
          {verifiedIne?<button type="button" className={secondary} onClick={()=>setPreview({label:"Frente de la INE verificada",path:`/api/player-registrations/${dossier.registrationId}/ine-verification/evidence`,body:{attemptId:verifiedIne,part:"front"}})}>Ver INE verificada</button>:<button type="button" aria-pressed={chosen} aria-controls="dossier-upload-form" onClick={()=>selectRequirement(r.id,true)} disabled={frozen || !storageConfigured || !dossier.canUpload || (type?.code==="PHOTO" && (r.required || r.quantity!==1))} className={`${secondary} inline-flex items-center gap-2`}>{chosen?<><Check aria-hidden="true" size={18}/>Seleccionado</>:current?`Sustituir ${type?.name ?? "documento"}`:`Adjuntar ${type?.name ?? "documento"}`}</button>}
        </li>;
      })}</ul>
    </section>
    <form id="dossier-upload-form" ref={form} onSubmit={submit} className="scroll-mt-6 space-y-5 rounded-xl border border-border bg-surface p-5" aria-label="Cargar documento">
      <h2 className="text-xl font-semibold">{requirement?`Adjuntar ${documentName}`:"Adjuntar documento"}</h2>
      <p className="text-sm text-muted">Elige un documento, revisa el archivo y guárdalo. Se adjunta un solo archivo por envío.</p>
      {!storageConfigured && <p role="status">El almacenamiento privado no está configurado.</p>}
      {!dossier.canUpload && <p role="status">El estado del expediente no permite nuevas cargas.</p>}
      <fieldset disabled={frozen || !storageConfigured || !dossier.canUpload} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Archivo y requisito</legend>
        <div className={requirement && requirement.quantity>1?"":"sm:col-span-2"}><label htmlFor="document-requirement" className="mb-2 block font-medium">1. Documento a adjuntar</label><SelectField id="document-requirement" name="requirementId" value={requirementId} onValueChange={value=>selectRequirement(value)} options={dossier.requirements.map(r=>({value:r.id,label:dossier.documentTypes.find(t=>t.id===r.typeId)?.name ?? "Documento",disabled:(dossier.documentTypes.find(t=>t.id===r.typeId)?.code==="PHOTO" && (r.required || r.quantity!==1))}))} required /></div>
        {requirement && requirement.quantity>1?<div><label htmlFor="document-slot" className="mb-2 block font-medium">Archivo que vas a adjuntar</label><SelectField id="document-slot" name="slot" value={slot} onValueChange={value=>{setSlot(value);setFile(null);setMessage("");setCameraVersion(version=>version+1);}} searchable={false} options={Array.from({length:requirement.quantity},(_,i)=>({value:String(i+1),label:`Archivo ${i+1} de ${requirement.quantity}`}))} required/><p className="mt-2 text-sm text-muted">Este documento requiere {requirement.quantity} archivos. Adjunta uno en cada envío.</p></div>:<input type="hidden" name="slot" value="1"/>}
        {!requirement && <p className="text-sm text-muted sm:col-span-2">Selecciona el documento aquí o pulsa Adjuntar en su tarjeta.</p>}
        {guardian && <div className="sm:col-span-2"><GuardianSignatureCapture key={`${dossier.registrationId}:${requirementId}`} registrationId={dossier.registrationId} playerName={dossier.player?.displayName} disabled={frozen || !storageConfigured || !dossier.canUpload} onPrepared={selectFile}/></div>}
        {requirement && <div className="space-y-4 rounded-xl border border-dashed border-border p-4 sm:col-span-2">
          <h3 className="font-semibold">2. {guardian?"Prepara la firma o elige la autorización firmada":photo?"Elige o toma la foto del jugador":"Elige el archivo o toma una foto del documento"}</h3>
          <div className="grid gap-5 sm:grid-cols-2"><div className="space-y-3"><p className="text-sm font-medium">Desde tu dispositivo</p><FilePickerButton id="document-file" photo={photo} selected={Boolean(file)} accept={photo?"image/jpeg,image/png":"application/pdf,image/jpeg,image/png"} disabled={frozen || !storageConfigured || !dossier.canUpload} describedBy="dossier-file-help dossier-upload-message" onSelect={selectFile}/><p className="text-xs text-muted">{photo?"PNG o JPEG":"PDF, PNG o JPEG"} · Hasta 10 MiB.</p></div>
            {!guardian && !frozen && storageConfigured && dossier.canUpload && <div className="space-y-3"><p className="text-sm font-medium">O usa la cámara</p><DevicePhotoCamera key={`${requirementId}:${slot}:${cameraVersion}`} compact selfie={photo} captureLabel={photo?"Vista en vivo para foto del jugador":`Vista en vivo para ${documentName}`} onCapture={selectFile}/><p className="text-xs text-muted">Se pedirá permiso. Solo se toma una foto, sin micrófono.</p></div>}
          </div>
        </div>}
      </fieldset>
      {file && phase!=="CONFIRMED" && <div className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-semibold">3. Revisa antes de guardar</h3><p role="status" className="break-all text-sm">{file.name} · {Math.ceil(file.size/1024)} KiB</p><LocalDocumentPreview file={file}/><p className="text-sm text-muted">{photo?"Comprueba que el rostro se vea completo y nítido.":"Comprueba que el documento esté completo, nítido y corresponda al jugador."} {phase==="EDITING"?"Todavía no se ha guardado.":phase==="SENDING"?"Esperando confirmación del servidor.":"No se ha podido confirmar la recepción; consulta el acuse antes de reenviar."}</p><button type="button" className={secondary} disabled={frozen} onClick={()=>selectFile(null)}>{photo?"Quitar foto":"Quitar archivo"}</button></div>}
      {selectedCurrent && phase==="EDITING" && <p className="rounded-xl border border-border p-4 text-sm">Ya existe un archivo para este documento. Si guardas uno nuevo, sustituirá al actual; conservaremos la versión anterior en el historial y se solicitará una nueva revisión.</p>}
      <div className="flex flex-wrap gap-3">
        {phase==="EDITING" && <button className="primary-action min-h-12 rounded-xl px-5 py-3 disabled:opacity-50" disabled={!file || !requirement || !storageConfigured || !dossier.canUpload}>{selectedCurrent?(photo?"Sustituir foto":"Sustituir documento"):(photo?"Guardar foto":"Guardar documento")}</button>}
        {phase==="SENDING" && <button type="button" disabled className={secondary}>Guardando…</button>}
        {phase==="UNCERTAIN" && <><button type="button" className={secondary} onClick={()=>void recover()}>Consultar acuse</button><button type="button" className={secondary} onClick={()=>void send()}>Reintentar este envío</button></>}
        {phase==="CONFIRMED" && <button type="button" className={secondary} onClick={()=>{pending.current=null;setFile(null);setRequirementId("");setSlot("1");setPhase("EDITING");setMessage("");}}>Adjuntar otro documento</button>}
      </div>
      <p id="dossier-upload-message" role="status" className={message?"rounded-xl border border-border p-4 text-sm leading-6":"sr-only"}>{message}</p>
      <p id="dossier-file-help" className="text-xs leading-6 text-muted">{photo?"Foto del jugador: PNG o JPEG de hasta 10 MiB.":"PNG, JPEG o PDF de hasta 10 MiB."} El archivo solo se conserva en esta pantalla; al salir o recargar tendrás que seleccionarlo otra vez. Una fotografía no demuestra por sí sola la originalidad del documento.</p>
    </form>
    <section className="space-y-3" aria-label="Archivos del expediente"><h2 className="text-xl font-semibold">Archivos recibidos e historial</h2>
      {!dossier.documents.length && <p>No se han recibido archivos.</p>}
      <ul className="space-y-3">{dossier.documents.map(doc=><li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4"><div><p>{dossier.documentTypes.find(t=>t.id===doc.typeId)?.name ?? "Documento histórico"}{doc.slot?` · Archivo ${doc.slot}`:""}</p><p className="mt-1 text-sm text-muted">{doc.superseded?"Versión anterior":doc.storageConfirmation!=="CONFIRMED"?"Confirmación pendiente de reconciliación":doc.reviewStatus==="VALIDATED"?"Revisado":doc.reviewStatus==="REJECTED"?"Requiere corrección":"Recibido · Pendiente de revisión"}</p></div><button type="button" disabled={phase==="SENDING" || phase==="UNCERTAIN" || doc.storageConfirmation!=="CONFIRMED"} onClick={()=>void download(doc.id)} className={secondary}>Ver documento</button></li>)}</ul>
    </section>
  </div>;
}
