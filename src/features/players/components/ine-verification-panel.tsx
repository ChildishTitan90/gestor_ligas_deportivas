"use client";
import {PrivateDocumentPreview,type DocumentPreviewRequest} from "./private-document-preview";
/* eslint-disable @next/next/no-img-element -- Vistas locales efímeras con blob URLs; sin optimizador ni transmisión de imágenes. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { canRetryIneVerification, ineParts, ineStatusSchema, type IneStatus } from "../ine-verification";
import { isProviderBlocked } from "../provider-retry";
import { ProviderRetryAuthorization } from "./provider-retry-authorization";
import { playerRequest } from "../player-client";
import { identityFieldLabels, playerErrorMessages } from "../player-feedback";
import { DevicePhotoCamera } from "./device-photo-camera";
import {Check} from "lucide-react";
import { FilePickerButton } from "@/components/ui/file-picker-button";
import { ProcessSteps } from "@/components/ui/process-steps";

const labels = { front: "Frente de la INE", back: "Reverso de la INE", selfie: "Selfie del jugador" };
const stepNames = ["Frente", "Reverso", "Selfie", "Revisión"];
const reverseTurnMs = 520;
const cameraStartDelay = [360, reverseTurnMs, 0];
function CaptureGuide({step}:{step:number}) {
  return <div className="ine-capture-guide" aria-hidden="true">
    <div className="ine-capture-corners" />
    {step===2?<svg className="ine-selfie-guide" viewBox="0 0 200 160" fill="none"><ellipse cx="100" cy="59" rx="30" ry="37"/><path d="M39 148c0-43 122-43 122 0M24 47V18h29m94 0h29v29m0 66v29h-29m-94 0H24v-29"/></svg>:<div className={`ine-guide-card${step===1?" ine-guide-card-back":""}`} style={{ animationDuration: `${reverseTurnMs}ms` }}>
      <div className="ine-guide-face ine-guide-front"><span>IDENTIFICACIÓN · FRENTE</span><div className="ine-guide-detail"><svg viewBox="0 0 70 80" fill="none"><circle cx="35" cy="24" r="15"/><path d="M8 72c0-33 54-33 54 0"/></svg><div><i/><i/><i/><i/></div></div><b>Coloca tu credencial dentro del marco</b></div>
      <div className="ine-guide-face ine-guide-back"><span>IDENTIFICACIÓN · REVERSO</span><div className="ine-guide-stripe"/><div className="ine-guide-barcode"/><b>Ahora muestra la parte de atrás</b></div>
    </div>}
  </div>;
}
const states: Record<IneStatus["status"], string> = {
  NOT_STARTED: "INE pendiente de verificar.",
  PENDING: "Consulta en proceso. Actualiza el resultado para ver la respuesta.",
  PROVIDER_PASSED: "El resultado anterior requiere cotejo de identidad por Secretaría.",
  IDENTITY_VERIFIED: "Identidad verificada: la INE y la selfie pasaron la validación del servicio y los datos coinciden con el registro.",
  ADMIN_REVIEW_REQUIRED: "Identidad sin verificar. Secretaría debe revisar las imágenes y los datos registrados.",
  INVALID_CREDENTIALS: "El servicio rechazó el acceso de la Liga. Pide apoyo a administración.",
  INSUFFICIENT_BALANCE: "El servicio no tiene saldo para esta consulta. Pide apoyo a administración.",
  UNAVAILABLE: "El servicio de INE está temporalmente fuera de servicio. Puedes reintentar más tarde.",
  UNCERTAIN: "El resultado de la consulta sigue sin confirmarse. Consulta el acuse y pide apoyo a administración si persiste.",
  STALE: "El expediente cambió. El resultado anterior ya no está vigente.",
  STORAGE_FAILED: "No se pudo resguardar la evidencia o comprobar el acceso antes de consultar al proveedor. Puedes reintentar cuando el servicio esté disponible.",
};
export function IneVerificationPanel({ actorId, initial, readOnly=false }: { actorId: string; initial: IneStatus;readOnly?:boolean }) {
  const [status, setStatus] = useState(initial), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState("");
  const previousAttempt = useRef<string | null>(null);
  const lock = useRef(false),resultRef=useRef<HTMLDivElement>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureIdentityVersion, setCaptureIdentityVersion] = useState<number | null>(null);
  const [startCamera, setStartCamera] = useState(false);
  const [step,setStep]=useState(0),[photos,setPhotos]=useState<Partial<Record<typeof ineParts[number],{file:File;url:string;source:"CAMERA"|"FILE"}>>>({});
  const previewUrls=useRef(new Set<string>()),stepHeading=useRef<HTMLHeadingElement>(null),moved=useRef(false);
  useEffect(()=>{if(!busy && (status.attemptId || uncertain)){resultRef.current?.focus();resultRef.current?.scrollIntoView({block:"start"});}},[busy,status.attemptId,status.status,uncertain]);
  useEffect(()=>{const urls=previewUrls.current;return()=>{for(const url of urls)URL.revokeObjectURL(url);};},[]);
  useEffect(()=>{if(moved.current)stepHeading.current?.focus();},[captureOpen,step]);
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
    if (lock.current) return; lock.current = true; setStartCamera(false); setBusy(true);
    try {
      const next = ineStatusSchema.parse(await playerRequest(actorId, endpoint));
      if (next.attemptId !== status.attemptId && !uncertain) setCaptureOpen(false);
      if (uncertain && next.attemptId && next.attemptId !== previousAttempt.current &&
        next.status !== "PENDING" && next.status !== "UNCERTAIN") {
        setUncertain(false);
        setCaptureOpen(false);
      }
      setStatus(next);
      setMessage("Resultado actualizado. Esta consulta no vuelve a enviar las fotos.");
    }
    catch { setMessage("No se pudo consultar el acuse. Conserva esta pantalla y vuelve a consultar."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || !mayStart) return;
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
        setMessage(playerErrorMessages[String(value.code)] ?? "No se inició otra verificación. Actualiza el resultado antes de volver a intentarlo."); return;
      }
      setStatus(ineStatusSchema.parse(value));setCaptureOpen(false);
    } catch {
      previousAttempt.current = status.attemptId;
      setUncertain(true);
      setMessage("No se confirmó el resultado del envío. Actualiza el resultado para consultar el acuse.");
    }
    finally { lock.current = false; setBusy(false); }
  }
  function download(part:typeof ineParts[number]){if(!status.attemptId)return;setPreview({label:labels[part],path:`${endpoint}/evidence`,body:{attemptId:status.attemptId,part}});}
  const canRetry = canRetryIneVerification(status.status, status.providerRetryAuthorized);
  const mayStart = !readOnly && status.canSubmit && !uncertain &&
    (status.status === "NOT_STARTED" || status.status === "STALE" || canRetry);
  function move(next:number, camera = false){if(lock.current || !mayStart)return;moved.current=true;setStartCamera(camera);setStep(next);setMessage("");}
  function beginCapture(camera: boolean) {
    if (lock.current || !mayStart) return;
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
    setCaptureIdentityVersion(status.identityVersion);
    setPhotos({});
    move(0, camera);
    setCaptureOpen(true);
  }
  function advance(){
    const photo = photos[ineParts[step]];
    if(!photo){setMessage("Primero toma o selecciona la foto de este paso.");return;}
    move(Math.min(step+1,3), photo.source === "CAMERA");
  }
  function selectPhoto(part:typeof ineParts[number],file?:File,source:"CAMERA"|"FILE"="FILE"){
    if(!file || lock.current || !mayStart)return;
    if(!file.size || file.size>10485760 || !["image/png","image/jpeg"].includes(file.type)){setMessage("Selecciona un PNG o JPEG de hasta 10 MiB.");return;}
    const previous=photos[part];if(previous){URL.revokeObjectURL(previous.url);previewUrls.current.delete(previous.url);}
    const url=URL.createObjectURL(file);previewUrls.current.add(url);setPhotos(current=>({...current,[part]:{file,url,source}}));setMessage("");
  }
  const part=ineParts[Math.min(step,2)],selected=photos[part];
  const canReusePhotos = canRetry &&
    captureIdentityVersion === status.identityVersion && ineParts.every(side => Boolean(photos[side]));
  const frameContent = selected ? <div className="ine-capture-preview" data-captured>
    <img src={selected.url} alt={`Vista previa: ${labels[part]}`} onError={()=>setMessage("No se puede mostrar esta imagen. Selecciona otra foto legible antes de continuar.")}/>
    <span className="ine-capture-check" aria-hidden="true"><Check size={22}/></span>
  </div> : <CaptureGuide step={step}/>;
  return <section aria-label="Verificación de INE y selfie" className="space-y-4 rounded-xl border border-border bg-surface p-5">
    {preview && <PrivateDocumentPreview actorId={actorId} request={preview} onClose={()=>setPreview(null)}/>}
    <h2 className="text-xl font-semibold">Verificación de INE y selfie</h2>
    <div ref={resultRef} tabIndex={-1} className={`scroll-mt-6 space-y-2 rounded-xl border p-4 ${status.status === "IDENTITY_VERIFIED" ? "border-positive bg-positive-surface text-positive" : "border-border bg-background"}`} aria-label="Resultado de verificación">
      <p role="status" className="font-semibold">{busy?"Procesando. Espera a que termine la consulta.":states[status.status]}</p>
      {status.status === "ADMIN_REVIEW_REQUIRED" && <div className="space-y-1 text-sm leading-6">
        {!!status.mismatchedFields?.length && <p>Campos que no coinciden: {status.mismatchedFields.map(field=>identityFieldLabels[field]).join(", ")}.</p>}
        {!!status.missingFields?.length && <p>Campos que el servicio no pudo confirmar: {status.missingFields.map(field=>identityFieldLabels[field]).join(", ")}.</p>}
        {!status.mismatchedFields?.length && !status.missingFields?.length && <p>El servicio no devolvió una validación concluyente de las imágenes.</p>}
      </div>}
      {message && <p role="status" className="text-sm leading-6">{message}</p>}
    </div>
    <p className="text-sm text-muted">La consulta de CURP en RENAPO no valida la INE. Aquí puedes revisar el resultado y las fotos de INE y selfie. Un resultado favorable que coincide con el jugador satisface el requisito compatible de identificación sin otra carga ni revisión de identidad. Los demás documentos y la habilitación deportiva se evalúan por separado.</p>
    <button type="button" onClick={() => void consult()} disabled={busy} className={button}>Actualizar resultado</button>
    {isProviderBlocked(status.status) && status.attemptId && <ProviderRetryAuthorization key={status.attemptId} kind="INE" actorId={actorId}
      registrationId={status.registrationId} attemptId={status.attemptId} state={status} disabled={busy}
      onAuthorized={value => setStatus(ineStatusSchema.parse(value))} />}
    {status.attemptId && <div className="flex flex-wrap gap-3">{ineParts.map(p => <button key={p} type="button" className={button} disabled={busy} onClick={() => void download(p)}>Consultar {labels[p].toLowerCase()}</button>)}</div>}
    {mayStart && !captureOpen && <div className="space-y-3 rounded-xl border border-border p-4">
      {status.attemptId && <p className="text-sm leading-6">Revisa el resultado anterior antes de preparar nuevas fotos.</p>}
      {canReusePhotos ? <button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3" disabled={busy} onClick={()=>{move(3);setCaptureOpen(true);}}>Revisar fotos para reintentar</button> : <>
        <p className="text-sm leading-6 text-muted">Captura el frente y el reverso de la INE y una selfie. Si eliges la cámara, el navegador solicitará acceso al video. Las fotos se enviarán al confirmar la verificación.</p>
        <div className="flex flex-wrap gap-3">
        <button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3" disabled={busy} onClick={()=>beginCapture(true)}>Iniciar con cámara</button>
        <button type="button" className={button} disabled={busy} onClick={()=>beginCapture(false)}>Usar fotos del dispositivo</button>
        </div>
      </>}
    </div>}
    {!readOnly && (status.canSubmit || uncertain) && captureOpen && <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy || !mayStart} className="space-y-4">
        <legend className="sr-only">Imágenes de verificación</legend>
        <ProcessSteps steps={stepNames} current={step} label="Pasos de captura de INE"
          completedSteps={[...ineParts.map(side=>Boolean(photos[side])),false]}/>
        <h3 ref={stepHeading} tabIndex={-1} className="text-xl font-semibold">{step<3?`Paso ${step+1}: ${labels[part]}`:"Revisa tus tres imágenes"}</h3>
        {step<3?<>
          <p className="text-sm text-muted">{step===0?"Coloca la credencial de frente, completa y sin reflejos. Asegúrate de que los datos se lean.":step===1?"Gira tu credencial y fotografía el reverso completo, sin tapar los códigos.":"Toma una selfie de frente, con buena luz y sin cubrir el rostro."}</p>

          {mayStart && !busy ? <DevicePhotoCamera key={`${part}:${selected?.url ?? ""}`} selfie={part==="selfie"}
            captureLabel={`Vista en vivo: ${labels[part]}`} idleFrame={frameContent}
            startAfterMs={startCamera && !selected ? cameraStartDelay[step] : undefined}
            onCapture={file=>selectPhoto(part,file,"CAMERA")}/>
            : <div className={`ine-live-frame ${part==="selfie"?"ine-live-selfie":"ine-live-document"}`}>{frameContent}</div>}
          <div key={part} className="ine-capture-inputs">
            <div className="space-y-2"><p className="text-sm">También puedes usar una foto de tu dispositivo.</p><FilePickerButton id={`ine-${part}`} name={part} photo selected={Boolean(selected)} accept="image/png,image/jpeg" disabled={busy || !mayStart} describedBy="ine-help" onSelect={file=>selectPhoto(part,file)}/></div>
          </div>
          {selected && <p role="status" className="text-sm"><strong className="text-positive">{selected.source==="CAMERA"?"Foto capturada.":"Foto seleccionada."}</strong> Comprueba que esté completa y nítida antes de continuar.</p>}
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
  </section>;
}
