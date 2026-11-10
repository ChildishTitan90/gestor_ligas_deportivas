"use client";
/* eslint-disable @next/next/no-img-element -- Blob efímero autorizado; sin optimizador ni caché compartida. */
import {useEffect,useState} from "react";
import {z} from "zod";
import {FormDialog} from "@/components/ui/form-dialog";
import {playerRequest} from "../player-client";
export type DocumentPreviewRequest={label:string;path:string;body:Record<string,unknown>};
const access=z.object({downloadUrl:z.string().url(),expiresInSeconds:z.number().int().positive().max(3600),mimeType:z.enum(["image/png","image/jpeg","application/pdf"])});
type Props={actorId:string;request:DocumentPreviewRequest;onClose:()=>void};
export function PrivateDocumentPreview(props:Props){
  return <PreviewContent key={`${props.actorId}:${props.request.path}:${JSON.stringify(props.request.body)}`} {...props}/>;
}
function PreviewContent({actorId,request,onClose}:Props){
  const [view,setView]=useState<{url:string;mime:string}|null>(null),[state,setState]=useState("LOADING"),[zoom,setZoom]=useState(false);
  useEffect(()=>{
    const abort=new AbortController();let objectUrl:string|null=null,timer:ReturnType<typeof setTimeout>|undefined,cancelled=false;
    const clear=()=>{if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}};
    async function open(){try{
      const started=Date.now(),result=access.parse(await playerRequest(actorId,request.path,request.body));
      if(cancelled)return;
      const target=new URL(result.downloadUrl);if(target.protocol!=="https:" && !(target.protocol==="http:" && target.hostname==="127.0.0.1"))throw Error();
      const remaining=Math.min(result.expiresInSeconds*1000,60000)-(Date.now()-started);if(remaining<=0)throw Error();
      timer=setTimeout(()=>{abort.abort();clear();setView(null);setState("EXPIRED");},remaining);
      const response=await fetch(result.downloadUrl,{cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer",signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});
      if(!response.ok)throw Error();const blob=await response.blob();
      if(cancelled || abort.signal.aborted)return;
      if(!blob.size || blob.size>10485760 || blob.type.split(";")[0]!==result.mimeType)throw Error();
      objectUrl=URL.createObjectURL(blob);setView({url:objectUrl,mime:result.mimeType});setState("READY");
    }catch{if(!cancelled && !abort.signal.aborted){clear();setState("ERROR");}}}
    void open();return()=>{cancelled=true;abort.abort();clearTimeout(timer);clear();};
  },[actorId,request]);
  return <FormDialog open title={request.label} description="Consulta privada y temporal. No se inicia una descarga ni una verificación de identidad." dismissLabel="Cerrar vista previa" onClose={onClose}>
    <div className="space-y-4" aria-busy={state==="LOADING"}>
      {state==="LOADING" && <p role="status">Autorizando y cargando el documento…</p>}
      {state==="ERROR" && <p role="alert">No se pudo mostrar este archivo o tu acceso ya no está disponible. Cierra la vista y vuelve a consultarlo.</p>}
      {state==="EXPIRED" && <p role="status">El acceso temporal venció. Cierra y vuelve a consultar el documento para autorizar otro acceso.</p>}
      {view && <>{view.mime==="application/pdf"?<><p className="text-sm text-muted">Documento PDF. Usa el visor para recorrer sus páginas. Si tu navegador no lo admite, prueba desde otro navegador compatible.</p><iframe title={`Documento PDF: ${request.label}`} referrerPolicy="no-referrer" src={`${view.url}#toolbar=0`} className="h-[60dvh] w-full rounded-xl border border-border bg-white"/></>:<><button type="button" aria-pressed={zoom} className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold" onClick={()=>setZoom(v=>!v)}>{zoom?"Ajustar a la pantalla":"Ampliar imagen"}</button><div className="max-h-[60dvh] overflow-auto rounded-xl border border-border bg-background"><img src={view.url} alt={request.label} referrerPolicy="no-referrer" onError={()=>{setView(null);setState("ERROR");}} className={zoom?"block max-w-none":"block max-h-[60dvh] w-full object-contain"}/></div></>}
      <p className="text-sm leading-6 text-muted">Al cerrar o vencer el acceso se retira esta copia de la vista. No compartas capturas ni datos del documento.</p></>}
    </div>
  </FormDialog>;
}
