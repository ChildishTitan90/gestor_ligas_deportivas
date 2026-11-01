"use client";
/* eslint-disable @next/next/no-img-element -- Vistas locales efímeras con blob URLs; sin optimizador ni transmisión de imágenes. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ineParts, ineStatusSchema, type IneStatus } from "../ine-verification";
import { playerRequest } from "../player-client";
import { DevicePhotoCamera } from "./device-photo-camera";

const labels = { front: "Frente de la INE", back: "Reverso de la INE", selfie: "Selfie del jugador" };
const stepNames = ["Frente", "Reverso", "Selfie", "Confirmar"];
function CaptureGuide({step}:{step:number}) {
  return <div className="ine-capture-guide" aria-hidden="true">
    <div className="ine-capture-corners" />
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
  INVALID_CREDENTIALS: "Revisar configuración del proveedor", INSUFFICIENT_BALANCE: "Saldo insuficiente",
  UNAVAILABLE: "Proveedor no disponible: revisar antes de otra consulta", UNCERTAIN: "Resultado incierto: puede haberse cobrado. No se reenvía automáticamente.",
  STALE: "La identidad o el contexto cambiaron: el resultado anterior no es vigente", STORAGE_FAILED: "No se completó el resguardo o la autorización previa. No se confirmó una consulta al proveedor.",
};
export function IneVerificationPanel({ actorId, initial }: { actorId: string; initial: IneStatus }) {
  const [status, setStatus] = useState(initial), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState("");
  const lock = useRef(false);
  const [step,setStep]=useState(0),[photos,setPhotos]=useState<Partial<Record<typeof ineParts[number],{file:File;url:string}>>>({});
  const previewUrls=useRef(new Set<string>()),stepHeading=useRef<HTMLHeadingElement>(null),moved=useRef(false);
  useEffect(()=>{const urls=previewUrls.current;return()=>{for(const url of urls)URL.revokeObjectURL(url);};},[]);
  useEffect(()=>{if(moved.current)stepHeading.current?.focus();},[step]);
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
    try { setStatus(ineStatusSchema.parse(await playerRequest(actorId, endpoint))); setMessage("Acuse consultado sin gastar créditos. Una intención pendiente o incierta no se vuelve a ejecutar al reenviarla."); }
    catch { setMessage("No se pudo consultar el acuse. Conserva esta pantalla y vuelve a consultar."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || uncertain) return;
    if(step<3){advance();return;}
    const form = new FormData(event.currentTarget);
    if(form.get("charge")!=="on" || (status.attemptId && form.get("previousCharge")!=="on")){setMessage("Confirma el envío y el consumo de créditos antes de continuar.");return;}
    for (const part of ineParts) { const f = photos[part]?.file; if (!(f instanceof File) || !f.size || f.size > 10485760 || !["image/png", "image/jpeg"].includes(f.type)) { setMessage("Selecciona las tres imágenes PNG o JPEG, de hasta 10 MiB cada una."); return; } }
    const payload = new FormData();
    for (const part of ineParts) payload.set(part, photos[part]!.file);
    payload.set("intent", JSON.stringify({ operationKey: crypto.randomUUID(), identityVersion: status.identityVersion,
      acknowledgeCharge: true, retryOf: status.attemptId, acknowledgePossiblePreviousCharge: form.get("previousCharge") === "on" }));
    lock.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", body: payload, cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(110000), headers: { "X-Expected-Actor-Id": actorId } });
      const value = await response.json();
      if (!response.ok) {
        if (response.status >= 500) throw new Error();
        setMessage(value.code === "USAGE_LIMIT_REACHED" ? "Se alcanzó el límite diario de consultas. Consulta el acuse." : `No se inició otra verificación (${String(value.code)}). Consulta el acuse antes de volver a intentar.`); return;
      }
      setStatus(ineStatusSchema.parse(value));
    } catch { setUncertain(true); setMessage("No se confirmó el resultado. Consulta el acuse; no vuelvas a enviar con otra intención. Si recargas, consulta el acuse antes de iniciar cualquier nueva consulta."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function download(part: typeof ineParts[number]) {
    if (lock.current || !status.attemptId) return; lock.current = true; setBusy(true);
    try { const value = await playerRequest(actorId, `${endpoint}/evidence`, { attemptId: status.attemptId, part });
      const url = (value as { downloadUrl?: string }).downloadUrl; if (!url) throw new Error(); window.location.assign(url); }
    catch { setMessage("No se pudo autorizar o confirmar la evidencia. No se generó una descarga pública."); }
    finally { lock.current = false; setBusy(false); }
  }
  const mayStart = status.canSubmit && !["PENDING", "IDENTITY_VERIFIED"].includes(status.status) && !uncertain;
  function move(next:number){if(lock.current || !mayStart)return;moved.current=true;setStep(next);setMessage("");}
  function advance(){if(!photos[ineParts[step]]){setMessage("Primero toma o selecciona la foto de este paso.");return;}move(Math.min(step+1,3));}
  function selectPhoto(part:typeof ineParts[number],file?:File){
    if(!file || lock.current || !mayStart)return;
    if(!file.size || file.size>10485760 || !["image/png","image/jpeg"].includes(file.type)){setMessage("Selecciona un PNG o JPEG de hasta 10 MiB.");return;}
    const previous=photos[part];if(previous){URL.revokeObjectURL(previous.url);previewUrls.current.delete(previous.url);}
    const url=URL.createObjectURL(file);previewUrls.current.add(url);setPhotos(current=>({...current,[part]:{file,url}}));setMessage("");
  }
  const part=ineParts[Math.min(step,2)],selected=photos[part];
  return <section aria-label="Verificación de INE y selfie" className="space-y-4 rounded-xl border border-border bg-surface p-5">
    <h2 className="text-xl font-semibold">Verificación de INE y selfie · Veteranos</h2>
    <p role="status">{states[status.status]}</p>
    <p className="text-sm text-muted">Estas imágenes son evidencia de verificación y no sustituyen las cargas del expediente. Una coincidencia facial no acredita por sí sola la identidad registrada, consentimiento ni elegibilidad deportiva.</p>
    <button type="button" onClick={() => void consult()} disabled={busy} className={button}>Consultar acuse sin gastar créditos</button>
    {status.attemptId && <div className="flex flex-wrap gap-3">{ineParts.map(p => <button key={p} type="button" className={button} disabled={busy} onClick={() => void download(p)}>Consultar {labels[p].toLowerCase()}</button>)}</div>}
    {status.canSubmit && <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy || !mayStart} className="space-y-4">
        <legend className="sr-only">Imágenes de verificación</legend>
        <ol className="ine-capture-progress" aria-label="Pasos de captura">{stepNames.map((name,index)=><li key={name} aria-current={step===index?"step":undefined}><span>{index+1}</span>{name}{index<step && <span className="sr-only">completado</span>}</li>)}</ol>
        <h3 ref={stepHeading} tabIndex={-1} className="text-xl font-semibold">{step<3?`Paso ${step+1}: ${labels[part]}`:"Revisa tus tres imágenes"}</h3>
        {step<3?<>
          <p className="text-sm text-muted">{step===0?"Coloca la credencial de frente, completa y sin reflejos. Asegúrate de que los datos se lean.":step===1?"Gira tu credencial y fotografía el reverso completo, sin tapar los códigos.":"Toma una selfie de frente, con buena luz y sin cubrir el rostro."}</p>
          <CaptureGuide step={step}/>
          {mayStart && !busy && <DevicePhotoCamera key={`camera-${part}`} selfie={part==="selfie"} onCapture={file=>selectPhoto(part,file)}/>}
          <div key={part} className="ine-capture-inputs">
            <div><label htmlFor={`ine-${part}`}>Elegir una foto del dispositivo</label><input id={`ine-${part}`} name={part} type="file" accept="image/png,image/jpeg" aria-describedby="ine-help" onChange={event=>{selectPhoto(part,event.target.files?.[0]);event.currentTarget.value="";}}/></div>
          </div>
          {selected && <div className="ine-capture-preview"><img src={selected.url} alt={`Vista previa: ${labels[part]}`} onError={()=>setMessage("No se puede mostrar esta imagen. Selecciona otra foto legible antes de continuar.")}/><p className="text-sm">Foto seleccionada. Comprueba que esté completa y nítida antes de continuar.</p></div>}
          <div className="flex flex-wrap gap-3">{step>0 && <button type="button" className={button} onClick={()=>move(step-1)}>Volver</button>}<button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3 disabled:opacity-50" disabled={!selected} onClick={advance}>{["Continuar al reverso","Continuar a la selfie","Revisar imágenes"][step]}</button></div>
        </>:<>
          <div className="ine-capture-summary">{ineParts.map((p,index)=><div key={p}><h4 className="font-semibold">{labels[p]}</h4>{photos[p] && <img src={photos[p]!.url} alt={`Vista previa: ${labels[p]}`}/>}<button type="button" className={button} onClick={()=>move(index)}>Repetir {stepNames[index].toLowerCase()}</button></div>)}</div>
        <label className="flex items-start gap-3"><input type="checkbox" name="charge" required className="mt-1" /><span>Confirmo el envío a Verificamex y su consumo de créditos. La documentación indica 20 tokens con selfie, sin QR. Revisaré el saldo y costo vigente antes de enviar.</span></label>
        {status.attemptId && <label className="flex items-start gap-3"><input type="checkbox" name="previousCharge" required className="mt-1" /><span>Ya consulté el acuse anterior y acepto que otra consulta puede generar un cobro adicional, aunque la anterior no tenga resultado.</span></label>}
        <button className="primary-action min-h-12 rounded-xl px-5 py-3 disabled:opacity-50">Consultar INE y selfie con proveedor</button>
        </>}
        <p id="ine-help" className="text-sm text-muted">PNG o JPEG, hasta 10 MiB por imagen. La cámara depende de tu dispositivo; también puedes elegir fotos. Solo se envían al confirmar el último paso. Al salir o recargar se pierde esta selección; no es un borrador guardado.</p>
      </fieldset>
    </form>}
    {busy && <p role="status">Procesando… No cierres esta pantalla.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
