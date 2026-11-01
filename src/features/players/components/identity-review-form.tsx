"use client";
import {useRef,useState} from "react";
import {SelectField} from "@/components/ui/select-field";
import {playerRequest} from "../player-client";
export function IdentityReviewForm({actorId,id,fingerprint,blocked}:{actorId:string;id:string;fingerprint:string;blocked:boolean}) {
  const [reason,setReason]=useState("");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const lock=useRef(false);
  return <form className="space-y-4" onSubmit={async event=>{event.preventDefault();if(lock.current || !reason)return;lock.current=true;setBusy(true);
    try{await playerRequest(actorId,`/api/player-registrations/${id}/identity-review`,{fingerprint,reason});setMessage("Decisión guardada. Si es un adulto con CURP verificada y cumple las reglas de su categoría, puede quedar activo. Consulta el listado actualizado.");}
    catch{setMessage("No se pudo confirmar la decisión. Recarga el expediente para consultar el resultado antes de volver a decidir.");}
    finally{setBusy(false);lock.current=false;}}}>
    <label htmlFor="review-reason">Resultado motivado de la revisión</label>
    <SelectField id="review-reason" name="reason" value={reason} onValueChange={setReason} disabled={busy || blocked} options={[
      {value:"DISTINCT_IDENTITIES_CONFIRMED",label:"Confirmé con los documentos que son personas distintas"},
      {value:"DOCUMENTS_INSUFFICIENT",label:"Documentación insuficiente: mantener revisión pendiente"}]} required />
    <p className="text-sm text-muted">Confirma la identidad con los documentos autorizados antes de resolver. Esta decisión no fusiona personas ni autoriza su participación.</p>
    {blocked && <p role="alert">Hay coincidencias fuera de tu alcance. Solicita revisión a administración; no se muestran esos expedientes.</p>}
    <button disabled={busy || blocked || !reason || Boolean(message)} className="primary-action rounded-xl px-5 py-3 disabled:opacity-50">{busy?"Guardando…":"Guardar revisión"}</button>
    {message && <p role="status">{message} <a className="underline" href={`/players/review/${id}`}>Consultar expediente actualizado</a></p>}
  </form>;
}
