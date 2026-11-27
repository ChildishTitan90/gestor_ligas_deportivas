"use client";
import {useRef,useState} from "react";
import {SelectField} from "@/components/ui/select-field";
import {ProcessSteps} from "@/components/ui/process-steps";
import {playerRequest} from "../player-client";
export function IdentityReviewForm({actorId,id,fingerprint,blocked,refreshHref}:{
  actorId:string;id:string;fingerprint:string;blocked:boolean;refreshHref:string;
}) {
  const [reason,setReason]=useState("");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [acknowledged,setAcknowledged]=useState(false);const lock=useRef(false);
  return <form className="space-y-4 rounded-xl border border-border bg-surface p-5" aria-busy={busy}
    onSubmit={async event=>{event.preventDefault();if(lock.current || !reason || blocked || message)return;lock.current=true;setBusy(true);
    try{
      const receipt:unknown=await playerRequest(actorId,`/api/player-registrations/${id}/identity-review`,{fingerprint,reason});
      if (!receipt || typeof receipt !== "object" || !("confirmed" in receipt) || receipt.confirmed !== true) throw Error();
      setAcknowledged(true);
      setMessage(reason==="DOCUMENTS_INSUFFICIENT"?"Decisión guardada. La revisión de identidad sigue pendiente por falta de documentación.":"Decisión guardada. Se registró que son personas distintas. Consulta el listado actualizado para conocer la habilitación.");
    }
    catch{setMessage("No se pudo confirmar la decisión. Recarga el expediente para consultar el resultado antes de volver a decidir.");}
    finally{setBusy(false);lock.current=false;}}}>
    <h2 className="text-lg font-semibold text-primary">Registrar decisión de identidad</h2>
    <ProcessSteps steps={["Comparar","Decisión","Acuse"]} current={acknowledged?3:busy || message?2:reason?1:0} label="Avance de la revisión de identidad" />
    <label htmlFor="review-reason">Resultado motivado de la revisión</label>
    <SelectField id="review-reason" name="reason" value={reason} onValueChange={setReason} disabled={busy || blocked || Boolean(message)} options={[
      {value:"DISTINCT_IDENTITIES_CONFIRMED",label:"Confirmé con los documentos que son personas distintas"},
      {value:"DOCUMENTS_INSUFFICIENT",label:"Documentación insuficiente: mantener revisión pendiente"}]} required />
    <p className="text-sm text-muted">Confirma la identidad con los documentos autorizados antes de resolver. Esta decisión no fusiona personas ni autoriza su participación.</p>
    {blocked && <p role="alert">Hay coincidencias fuera de tu alcance. Solicita revisión a administración; no se muestran esos expedientes.</p>}
    <button disabled={busy || blocked || !reason || Boolean(message)} className="primary-action min-h-12 rounded-xl px-5 py-3 disabled:opacity-50">{busy?"Guardando…":"Guardar revisión"}</button>
    {message && <div className="space-y-2 rounded-xl border border-border bg-background p-4"><p role="status">{message}</p><a className="inline-flex min-h-11 items-center underline underline-offset-4" href={refreshHref}>Consultar expediente actualizado</a></div>}
  </form>;
}
