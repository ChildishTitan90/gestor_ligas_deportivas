"use client";
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from "react";
import {useRouter} from "next/navigation";
import type {ZodType} from "zod";
function subscribePending(listener:()=>void){window.addEventListener("refereeing-operation",listener);window.addEventListener("storage",listener);return()=>{window.removeEventListener("refereeing-operation",listener);window.removeEventListener("storage",listener);};}
export function useRefereeOperation({actorId,endpoint,storageNamespace,schema,base={},messages,onRecovered,buildRequest}:{actorId:string;endpoint:string;storageNamespace:string;schema:ZodType<Record<string,unknown>>;base?:Record<string,unknown>;messages:Record<string,string>;onRecovered?:()=>void;buildRequest?:(payload:Record<string,unknown>)=>Record<string,unknown>}){
  const router = useRouter();
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(""), [reason, setReason] = useState("");
  const operation = useRef<Record<string, unknown> | null>(null), busy = useRef(false);
  const [retryReady,setRetryReady]=useState(false);
  const storageKey=`${storageNamespace}:${actorId}`;
  const stored=useSyncExternalStore(subscribePending,()=>{try{return sessionStorage.getItem(storageKey);}catch{return null;}},()=>null);
  const restored=useMemo(()=>{try{const parsed=schema.safeParse(JSON.parse(stored??"null"));return parsed.success?parsed.data:null;}catch{return null;}},[stored,schema]);
  function forget() { operation.current=null;try{sessionStorage.removeItem(storageKey);window.dispatchEvent(new Event("refereeing-operation"));}catch{} }
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    if (pending || uncertain || restored) window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending, uncertain, restored]);
  async function mutate(command: Record<string, unknown>, replay=false) {
    if (busy.current || (uncertain || restored) && !replay) return false;
    if (!operation.current && reason.trim().length < 5) { setError("Escribe un motivo de al menos cinco caracteres."); return false; }
    busy.current = true; setPending(true); setError("");
    const payload = operation.current ?? { ...command, ...base, reason: reason.trim(), operationKey: crypto.randomUUID() };
    operation.current = payload;
    try{sessionStorage.setItem(storageKey,JSON.stringify(payload));window.dispatchEvent(new Event("refereeing-operation"));}catch{}
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Expected-Actor-Id": actorId }, body: JSON.stringify(buildRequest?buildRequest(payload):payload), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 500 || response.status===401 || response.status===403) throw Error("UNCERTAIN");
        forget(); setUncertain(false);setRetryReady(false);setError(messages[result.code] ?? `No se aplicó la operación: ${result.code}. Consulta los datos vigentes.`); router.refresh(); return false;
      }
      if (result.operationKey !== payload.operationKey || typeof result.id !== "string" || !Number.isInteger(result.version)) throw Error("UNCERTAIN");
      forget(); setUncertain(false);setRetryReady(false);setReason(""); router.refresh(); return true;
    } catch { setUncertain(true); setError("No se pudo confirmar el resultado. Conservamos la solicitud y su versión en esta vista. Consulta el resultado antes de volver a enviar; no recargues ni salgas."); return false; }
    finally { busy.current = false; setPending(false); }
  }
  async function recover() {
    operation.current??=restored;
    if (busy.current || !operation.current) return;
    busy.current = true; setPending(true);
    try {
      const response = await fetch(`${endpoint}?operationKey=${operation.current.operationKey}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error();
      const result = await response.json();
      if (result.receipt?.operationKey === operation.current.operationKey) { forget(); setUncertain(false);setRetryReady(false); setReason(""); setError(onRecovered?"":"La operación fue confirmada. Cierra el diálogo y consulta la información actualizada."); onRecovered?.(); router.refresh(); }
      else { setRetryReady(true); setError("Todavía no existe un acuse. Puedes reintentar la misma solicitud: se conservarán su clave, contenido y versión."); }
    } catch { setError("No se pudo consultar el resultado. La solicitud sigue conservada en esta vista."); }
    finally { busy.current = false; setPending(false); }
  }

  return {pending,uncertain:uncertain||!!restored,error:error||(!pending&&restored?"Hay una solicitud de esta cuenta sin confirmar. Consulta su resultado; no se reenvía automáticamente.":""),reason,onReasonChange:setReason,mutate,recover,retryReady,savedCommand:restored,hasOperation:!!restored||pending||uncertain,retry:async()=>{if(operation.current&&retryReady&&await mutate(operation.current,true)){if(onRecovered)onRecovered();else setError("Operación confirmada. Cierra el diálogo para continuar.");}}};
}
