"use client";
import { useEffect, useRef, useState } from "react";
import {cameraCrop} from "../camera-framing";

/** Cámara local: nunca transmite el stream ni solicita audio. Solo entrega una foto al padre. */
export function DevicePhotoCamera({ selfie, onCapture, captureLabel,compact=false }: { selfie: boolean; onCapture: (file: File) => void; captureLabel?:string;compact?:boolean }) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null);
  const viewport=useRef<HTMLDivElement>(null),documentCapture=!selfie && !compact;
  const generation = useRef(0), mounted = useRef(false), opening = useRef(false), taking = useRef(false);
  const [mode, setMode] = useState<"IDLE" | "OPENING" | "LIVE" | "CAPTURING">("IDLE");
  const [ready, setReady] = useState(false), [message, setMessage] = useState("");
  const button = "min-h-12 rounded-xl border border-border px-4 py-3 font-semibold disabled:opacity-50";
  function release() {
    generation.current++; opening.current = false; taking.current = false;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
  }
  function stop() { release(); if (mounted.current) { setMode("IDLE"); setReady(false); } }
  useEffect(() => {
    mounted.current = true;
    const hidden = () => { if (document.visibilityState === "hidden") stop(); };
    const pageExit = () => stop();
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", pageExit);
    return () => { mounted.current = false; release(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", pageExit); };
    // Las refs gestionan exclusivamente los recursos de esta instancia/paso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function start() {
    if (opening.current || stream.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setMessage("La cámara en la página requiere HTTPS o localhost y un navegador compatible. Puedes elegir una foto del dispositivo."); return;
    }
    opening.current = true; const requestGeneration = ++generation.current; setMode("OPENING"); setMessage(""); setReady(false);
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        facingMode: { ideal: selfie ? "user" : "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 },
      } });
      // El permiso puede resolverse después de cancelar, cambiar de paso o abandonar la página.
      if (!mounted.current || requestGeneration !== generation.current || document.visibilityState === "hidden") {
        acquired.getTracks().forEach(track => track.stop()); return;
      }
      stream.current = acquired;
      for (const track of acquired.getVideoTracks()) track.addEventListener("ended", () => {
        if (stream.current === acquired) { stop(); setMessage("La cámara se desconectó. Puedes activarla de nuevo o elegir una foto."); }
      }, { once: true });
      if (!video.current) { stop(); return; }
      video.current.srcObject = acquired; setMode("LIVE");
      await video.current.play();
    } catch (error) {
      if (!mounted.current || requestGeneration !== generation.current) return;
      stop();
      const name = error instanceof DOMException ? error.name : "";
      setMessage(name === "NotAllowedError" ? "No se autorizó la cámara. Puedes revisar el permiso del sitio o elegir una foto del dispositivo." : name === "NotFoundError" ? "No se encontró una cámara. Puedes elegir una foto del dispositivo." : "No se pudo abrir la cámara. Puede estar ocupada; ciérrala en otra aplicación o elige una foto.");
    } finally { if (requestGeneration === generation.current) opening.current = false; }
  }
  async function capture() {
    if (taking.current || !ready || !video.current || !stream.current) return;
    const frame = video.current, requestGeneration = generation.current;
    if (!frame.videoWidth || !frame.videoHeight || frame.readyState < 2) { setMessage("Espera a que la cámara muestre la imagen antes de tomar la foto."); return; }
    taking.current = true; setMode("CAPTURING");
    try {
      const bounds=viewport.current!.getBoundingClientRect();
      const crop=cameraCrop(frame.videoWidth,frame.videoHeight,bounds.width,bounds.height,selfie?.08:documentCapture?.06:0);
      const canvas = document.createElement("canvas"), ratio = Math.min(1, 1920 / Math.max(crop.width,crop.height));
      canvas.width = Math.max(1, Math.round(crop.width * ratio)); canvas.height = Math.max(1, Math.round(crop.height * ratio));
      const context = canvas.getContext("2d"); if (!context) throw new Error();
      // La vista previa y el archivo usan exactamente la misma región central.
      context.drawImage(frame,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
      canvas.width = 0; canvas.height = 0;
      if (!mounted.current || requestGeneration !== generation.current) return;
      if (!blob || blob.type !== "image/jpeg" || !blob.size || blob.size > 10485760) throw new Error();
      stop(); onCapture(new File([blob], selfie ? "selfie.jpg" : "credencial.jpg", { type: "image/jpeg" }));
      setMessage("Foto tomada. Revisa la vista previa antes de continuar. La cámara está apagada.");
    } catch {
      if (mounted.current && requestGeneration === generation.current) { taking.current = false; setMode("LIVE"); setMessage("No se pudo tomar la foto. Inténtalo de nuevo o elige un archivo."); }
    }
  }
  return <div className="ine-device-camera space-y-3">
    {!compact && <><p className="font-semibold">Cámara del dispositivo</p>
    <p className="text-sm text-muted">{selfie ? "Se solicitará la cámara frontal si está disponible." : "Se solicitará la cámara trasera si está disponible."} Solo se usa video, sin micrófono. La imagen permanece aquí hasta el envío final.</p></>}
    <div ref={viewport} className={`ine-live-frame ${documentCapture?"ine-live-document":"ine-live-portrait"}${selfie?" ine-live-selfie":""}`} hidden={mode !== "LIVE" && mode !== "CAPTURING"}>
      <video ref={video} autoPlay playsInline muted aria-label={captureLabel ?? (selfie ? "Vista en vivo para selfie" : "Vista en vivo para INE")} onLoadedData={() => setReady(true)} onCanPlay={() => setReady(true)} />
      <span aria-hidden="true" className={`ine-live-outline${selfie ? " ine-live-outline-selfie" : ""}`} />
    </div>
    {(mode==="LIVE" || mode==="CAPTURING") && <p className="text-sm text-muted">{documentCapture?"Acerca la INE y deja sus cuatro bordes dentro del marco, con un pequeño margen. Se guardará el área del marco; no es un escaneo automático.":selfie?"Acerca el rostro hasta llenar el óvalo: incluye la frente y el mentón, y apenas el inicio de los hombros. Se guarda el área del óvalo como una foto rectangular; no detectamos la cara automáticamente.":"Centra el rostro completo y los hombros. La foto conservará el encuadre que ves."}</p>}
    <div className="flex flex-wrap gap-3">
      {mode === "IDLE" ? <button type="button" className={button} onClick={() => void start()}>{compact?"Tomar foto":"Activar cámara"}</button> : <>
        {(mode === "LIVE" || mode === "CAPTURING") && <button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3 disabled:opacity-50" disabled={!ready || mode === "CAPTURING"} onClick={() => void capture()}>{mode === "CAPTURING" ? "Tomando foto…" : "Tomar esta foto"}</button>}
        <button type="button" className={button} onClick={stop}>{mode === "OPENING" ? "Cancelar activación" : "Apagar cámara"}</button>
      </>}
    </div>
    {mode === "OPENING" && <p role="status">Autoriza el acceso en el aviso del navegador. Puedes cancelar sin perder las fotos anteriores.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
