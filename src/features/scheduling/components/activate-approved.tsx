"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { activateApprovedSchedule } from "../activation-actions";

export function ActivateApproved({proposalId,version}:{proposalId:string;version:number}) {
  const [pending,start]=useTransition(),[message,setMessage]=useState("");
  const router=useRouter();
  return <div className="mt-4 space-y-2 rounded-xl border border-border p-4">
    <p>Esta programación se aprobó antes de registrar automáticamente los partidos. Al activarla se comprobarán nuevamente las canchas y se reservarán los horarios.</p>
    <button type="button" className="secondary-action min-h-12 rounded-xl border border-border px-4" disabled={pending} onClick={()=>start(async()=>{
      try {const result=await activateApprovedSchedule({proposalId,expectedVersion:version,reason:"Activar programación previamente aprobada"});
        if(result.code==="SCHEDULE_ACTIVATED") {setMessage("Partidos y reservas registrados.");router.refresh();}
        else setMessage(result.code==="PROPOSAL_ALREADY_MATERIALIZED"?"Esta programación ya tiene partidos. Actualiza la página.":"No se pudo activar: revisa que la propuesta y los horarios sigan vigentes.");
      } catch {setMessage("No se pudo confirmar el resultado. Actualiza la página antes de intentarlo de nuevo.");}
    })}>{pending?"Validando…":"Activar partidos aprobados"}</button>
    {message && <p role="status">{message}</p>}
  </div>;
}
