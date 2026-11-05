"use client";
import {PrivateDocumentPreview,type DocumentPreviewRequest} from "./private-document-preview";
/* eslint-disable @next/next/no-img-element -- Vistas locales efímeras con blob URLs; sin optimizador ni transmisión de imágenes. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ineParts, ineStatusSchema, type IneStatus } from "../ine-verification";
import { playerRequest } from "../player-client";
import { DevicePhotoCamera } from "./device-photo-camera";
import {Check} from "lucide-react";
import { FilePickerButton } from "@/components/ui/file-picker-button";

const labels = { front: "Frente de la INE", back: "Reverso de la INE", selfie: "Selfie del jugador" };
const stepNames = ["Frente", "Reverso", "Selfie", "Verificar"];
function CaptureGuide({step,captured}:{step:number;captured:boolean}) {
  return <div className="ine-capture-guide ine-capture-guide-compact" data-captured={captured || undefined} aria-hidden="true">
    <div className="ine-capture-corners" />
    {captured && <span className="ine-capture-check"><Check size={22}/></span>}
    {step===2?<svg className="ine-selfie-guide" viewBox="0 0 200 160" fill="none"><ellipse cx="100" cy="59" rx="30" ry="37"/><path d="M39 148c0-43 122-43 122 0M24 47V18h29m94 0h29v29m0 66v29h-29m-94 0H24v-29"/></svg>:<div className={`ine-guide-card${step===1?" ine-guide-card-back":""}`}>
      <div className="ine-guide-face ine-guide-front"><span>IDENTIFICACIÓN · FRENTE</span><div className="ine-guide-detail"><svg viewBox="0 0 70 80" fill="none"><circle cx="35" cy="24" r="15"/><path d="M8 72c0-33 54-33 54 0"/></svg><div><i/><i/><i/><i/></div></div><b>Coloca tu credencial dentro del marco</b></div>
      <div className="ine-guide-face ine-guide-back"><span>IDENTIFICACIÓN · REVERSO</span><div className="ine-guide-stripe"/><div className="ine-guide-barcode"/><b>Ahora muestra la parte de atrás</b></div>
    </div>}
  </div>;
}
const states: Record<IneStatus["status"], string> = {
  NOT_STARTED: "Sin consulta", PENDING: "En proceso: consulta el acuse sin reenviar",
  PROVIDER_PASSED: "Resultado anterior sin cotejo automático. Requiere revisión administrativa.",
  IDENTITY_VERIFIED: "Identidad verificada: Verificamex reportó validación favorable y los datos coinciden con el registro. La aprobación documental y deportiva sigue pendiente.",
  ADMIN_REVIEW_REQUIRED: "Revisión administrativa pendiente: imagen, coincidencia o respuesta no concluyente. El jugador no fue rechazado.",
  INVALID_CREDENTIALS: "La verificación no está disponible. Solicita apoyo a administración.", INSUFFICIENT_BALANCE: "La verificación no está disponible. Solicita apoyo a administración.",
  UNAVAILABLE: "Proveedor no disponible: revisar antes de otra consulta", UNCERTAIN: "No se pudo confirmar el resultado. Actualízalo antes de intentar otro envío.",
  STALE: "La identidad o el contexto cambiaron: el resultado anterior no es vigente", STORAGE_FAILED: "No se completó el resguardo o la autorización previa. No se confirmó una consulta al proveedor.",
};
export function IneVerificationPanel({ actorId, initial, readOnly=false }: { actorId: string; initial: IneStatus;readOnly?:boolean }) {
  const [status, setStatus] = useState(initial), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false),resultRef=useRef<HTMLDivElement>(null);
  const [newAttemptRequested,setNewAttemptRequested]=useState(false);
  const [step,setStep]=useState(0),[photos,setPhotos]=useState<Partial<Record<typeof ineParts[number],{file:File;url:string;source:"CAMERA"|"FILE"}>>>({});
  const previewUrls=useRef(new Set<string>()),stepHeading=useRef<HTMLHeadingElement>(null),moved=useRef(false);
  useEffect(()=>{if(!busy && (status.attemptId || uncertain)){resultRef.current?.focus();resultRef.current?.scrollIntoView({block:"start"});}},[busy,status.attemptId,status.status,uncertain]);
  useEffect(()=>{const urls=previewUrls.current;return()=>{for(const url of urls)URL.revokeObjectURL(url);};},[]);
  useEffect(()=>{if(moved.current)stepHeading.current?.focus();},[step]);
  const [preview,setPreview]=useState<DocumentPreviewRequest|null>(null);
  const endpoint = `/api/player-registrations/${status.registrationId}/ine-verification`;
  const button = "min-h-12 rounded-xl border border-border px-4 py-3 font-semibold disabled:opacity-50";
  useEffect(() => {
    if (!busy && !uncertain && !Object.keys(photos).length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [busy, uncertain, photos]);
  if (!status.applicable) return null;
  async function consult() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { setStatus(ineStatusSchema.parse(await playerRequest(actorId, endpoint))); setMessage("Resultado actualizado. Esta consulta no vuelve a enviar las fotos."); }
    catch { setMessage("No se pudo consultar el acuse. Conserva esta pantalla y vuelve a consultar."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || uncertain) return;
    if(step<3){advance();return;}
    const form = new FormData(event.currentTarget);
    if(status.attemptId && form.get("previousCharge")!=="on"){setMessage("Confirma que deseas iniciar una nueva verificación después de revisar el resultado anterior.");return;}
    for (const part of ineParts) { const f = photos[part]?.file; if (!(f instanceof File) || !f.size || f.size > 10485760 || !["image/png", "image/jpeg"].includes(f.type)) { setMessage("Selecciona las tres imágenes PNG o JPEG, de hasta 10 MiB cada una."); return; } }
    const payload = new FormData();
    for (const part of ineParts) payload.set(part, photos[part]!.file);
    payload.set("intent", JSON.stringify({ operationKey: crypto.randomUUID(), identityVersion: status.identityVersion,
      acknowledgeCharge: true, retryOf: status.attemptId, acknowledgePossiblePreviousCharge: form.get("previousCharge") === "on" }));
    lock.current = true; setBusy(true); setMessage("");resultRef.current?.scrollIntoView({block:"start"});
    try {
      const response = await fetch(endpoint, { method: "POST", body: payload, cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(110000), headers: { "X-Expected-Actor-Id": actorId } });
      const value = await response.json();
      if (!response.ok) {
        if (response.status >= 500) throw new Error();
        setMessage(value.code === "USAGE_LIMIT_REACHED" ? "Se alcanzó el límite diario de consultas. Consulta el acuse." : `No se inició otra verificación (${String(value.code)}). Consulta el acuse antes de volver a intentar.`); return;
      }
      setStatus(ineStatusSchema.parse(value));setNewAttemptRequested(false);
    } catch { setUncertain(true); setMessage("No se confirmó el resultado. Consulta el acuse; no vuelvas a enviar con otra intención. Si recargas, consulta el acuse antes de iniciar cualquier nueva consulta."); }
    finally { lock.current = false; setBusy(false); }
  }
  function download(part:typeof ineParts[number]){if(!status.attemptId)return;setPreview({label:labels[part],path:`${endpoint}/evidence`,body:{attemptId:status.attemptId,part}});}
  const mayStart = !readOnly && status.canSubmit && !["PENDING", "IDENTITY_VERIFIED"].includes(status.status) && !uncertain;
  function move(next:number){if(lock.current || !mayStart)return;moved.current=true;setStep(next);setMessage("");}
  function advance(){if(!photos[ineParts[step]]){setMessage("Primero toma o selecciona la foto de este paso.");return;}move(Math.min(step+1,3));}
  function selectPhoto(part:typeof ineParts[number],file?:File,source:"CAMERA"|"FILE"="FILE"){
    if(!file || lock.current || !mayStart)return;
    if(!file.size || file.size>10485760 || !["image/png","image/jpeg"].includes(file.type)){setMessage("Selecciona un PNG o JPEG de hasta 10 MiB.");return;}
    const previous=photos[part];if(previous){URL.revokeObjectURL(previous.url);previewUrls.current.delete(previous.url);}
    const url=URL.createObjectURL(file);previewUrls.current.add(url);setPhotos(current=>({...current,[part]:{file,url,source}}));setMessage("");
  }
  const part=ineParts[Math.min(step,2)],selected=photos[part];
  return <section aria-label="Verificación de INE y selfie" className="space-y-4 rounded-xl border border-border bg-surface p-5">
    {preview && <PrivateDocumentPreview actorId={actorId} request={preview} onClose={()=>setPreview(null)}/>}
    <h2 className="text-xl font-semibold">Verificación de INE y selfie</h2>
    <div ref={resultRef} tabIndex={-1} className="scroll-mt-6 space-y-2 rounded-xl border border-border bg-background p-4" aria-label="Resultado de verificación"><p role="status" className="font-semibold">{busy?"Procesando tu solicitud. Espera aquí; no vuelvas a enviarla.":states[status.status]}</p>{message && <p role="status" className="text-sm leading-6">{message}</p>}</div>
    <p className="text-sm text-muted">La consulta de CURP en RENAPO no valida la INE. Aquí puedes revisar el resultado y las fotos de INE y selfie. Un resultado favorable que coincide con el jugador satisface el requisito compatible de identificación sin otra carga ni revisión de identidad. Los demás documentos y la habilitación deportiva se evalúan por separado.</p>
    <button type="button" onClick={() => void consult()} disabled={busy} className={button}>Actualizar resultado</button>
    {status.attemptId && <div className="flex flex-wrap gap-3">{ineParts.map(p => <button key={p} type="button" className={button} disabled={busy} onClick={() => void download(p)}>Consultar {labels[p].toLowerCase()}</button>)}</div>}
    {!readOnly && status.canSubmit && (!status.attemptId || newAttemptRequested || uncertain) && <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy || !mayStart} className="space-y-4">
        <legend className="sr-only">Imágenes de verificación</legend>
        <ol className="ine-capture-progress" aria-label="Pasos de captura">{stepNames.map((name,index)=><li key={name} aria-current={step===index?"step":undefined}><span>{index<3 && photos[ineParts[index]]?<Check size={16} aria-hidden="true"/>:index+1}</span>{name}{index<3 && photos[ineParts[index]] && <span className="sr-only">foto lista</span>}</li>)}</ol>
        <h3 ref={stepHeading} tabIndex={-1} className="text-xl font-semibold">{step<3?`Paso ${step+1}: ${labels[part]}`:"Revisa tus tres imágenes"}</h3>
        {step<3?<>
          <p className="text-sm text-muted">{step===0?"Coloca la credencial de frente, completa y sin reflejos. Asegúrate de que los datos se lean.":step===1?"Gira tu credencial y fotografía el reverso completo, sin tapar los códigos.":"Toma una selfie de frente, con buena luz y sin cubrir el rostro."}</p>

          <CaptureGuide step={step} captured={Boolean(selected)}/>
          {mayStart && !busy && <DevicePhotoCamera key={`camera-${part}`} selfie={part==="selfie"} onCapture={file=>selectPhoto(part,file,"CAMERA")}/>}
          <div key={part} className="ine-capture-inputs">
            <div className="space-y-2"><p className="text-sm">También puedes usar una foto de tu dispositivo.</p><FilePickerButton id={`ine-${part}`} name={part} photo selected={Boolean(selected)} accept="image/png,image/jpeg" disabled={busy || !mayStart} describedBy="ine-help" onSelect={file=>selectPhoto(part,file)}/></div>
          </div>
          {selected && <div className="ine-capture-preview ine-capture-preview-ready" key={selected.url}><p role="status" className="flex items-center gap-2 font-semibold text-positive"><Check aria-hidden="true" size={22}/>{selected.source==="CAMERA"?"Foto capturada":"Foto seleccionada"}</p><img src={selected.url} alt={`Vista previa: ${labels[part]}`} onError={()=>setMessage("No se puede mostrar esta imagen. Selecciona otra foto legible antes de continuar.")}/><p className="text-sm">Comprueba que esté completa y nítida antes de continuar. Este check confirma la captura; la identidad se verificará al finalizar.</p></div>}
          <div className="flex flex-wrap gap-3">{step>0 && <button type="button" className={button} onClick={()=>move(step-1)}>Volver</button>}<button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3 disabled:opacity-50" disabled={!selected} onClick={advance}>{["Continuar al reverso","Continuar a la selfie","Revisar imágenes"][step]}</button></div>
        </>:<>
          <div className="ine-capture-summary">{ineParts.map((p,index)=><div key={p}><h4 className="font-semibold">{labels[p]}</h4>{photos[p] && <img src={photos[p]!.url} alt={`Vista previa: ${labels[p]}`}/>}<button type="button" className={button} onClick={()=>move(index)}>Repetir {stepNames[index].toLowerCase()}</button></div>)}</div>
        <p className="text-sm leading-6 text-muted">Revisa que las tres fotos sean legibles y correspondan al jugador. Al pulsar «Verificar identidad» se enviarán al servicio de verificación para comprobar la INE, la selfie y su coincidencia con los datos registrados.</p>
        {status.attemptId && <label className="flex items-start gap-3"><input type="checkbox" name="previousCharge" required className="mt-1" /><span>Ya revisé el resultado anterior y quiero iniciar una nueva verificación con estas fotos.</span></label>}
        <button className="primary-action min-h-12 rounded-xl px-5 py-3 disabled:opacity-50">Verificar identidad</button>
        </>}
        <p id="ine-help" className="text-sm text-muted">Puedes tomar fotos o elegir imágenes PNG/JPEG de hasta 10 MiB. Se enviarán al verificar la identidad. Si sales o recargas antes, tendrás que seleccionarlas otra vez.</p>
      </fieldset>
    </form>}
    {!readOnly && status.canSubmit && status.attemptId && !newAttemptRequested && !uncertain && !["PENDING","IDENTITY_VERIFIED"].includes(status.status) && <div className="space-y-3 rounded-xl border border-border p-4"><p className="text-sm leading-6">La verificación anterior ya tiene un resultado. Revísalo antes de preparar otras fotos. Prepararlas no envía una nueva solicitud.</p><button type="button" className={button} disabled={busy} onClick={()=>{for(const url of previewUrls.current)URL.revokeObjectURL(url);previewUrls.current.clear();setPhotos({});setNewAttemptRequested(true);moved.current=true;setStep(0);}}>Preparar nuevas fotos</button></div>}
  </section>;
}
