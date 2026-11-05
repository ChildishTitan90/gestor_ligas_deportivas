"use client";
import {useEffect,useId,useRef,useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {ActionLink} from "@/components/ui/action-link";
import {SelectField} from "@/components/ui/select-field";
import {playerRequest,PlayerRequestError} from "../player-client";
import {participationReceiptSchema,participationMessages,type ParticipationWorkspace} from "../participation-workspace";
import {EligibilityDecisionForm} from "./eligibility-decision-form";

export function PlayerParticipationWorkspace({data}:{data:ParticipationWorkspace}){
  const router=useRouter(),prefix=useId(),lock=useRef(false),intent=useRef<unknown>(null);
  const [target,setTarget]=useState(""),[reason,setReason]=useState(""),[phase,setPhase]=useState("EDITING"),[message,setMessage]=useState("");
  const endpoint=`/api/player-registrations/${data.registrationId}/category-participations`;
  useEffect(()=>{if(phase!=="SENDING" && phase!=="UNCERTAIN")return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[phase]);
  async function send(){if(lock.current || !intent.current)return;lock.current=true;setPhase("SENDING");
    try{const value=participationReceiptSchema.safeParse(await playerRequest(data.actorId,endpoint,intent.current));if(!value.success)throw new PlayerRequestError("UNCONFIRMED",true);setPhase("CONFIRMED");intent.current=null;setMessage("Solicitud confirmada. Su autorización se revisa por separado.");router.refresh();}
    catch(error){if(error instanceof PlayerRequestError && !error.uncertain){setPhase("EDITING");intent.current=null;setMessage(participationMessages[error.code] ?? "No se pudo recibir la solicitud.");}else{setPhase("UNCERTAIN");setMessage("No se confirmó el resultado. Conservamos la misma intención para consultar o reintentar.");}}finally{lock.current=false;}}
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(lock.current || phase!=="EDITING" || !data.targets.some(t=>t.targetId===target))return;intent.current={operationKey:crypto.randomUUID(),targetSeasonTeamId:target,reason};void send();}
  const targets=data.targets.filter(t=>!data.participations.some(p=>p.targetSeasonCategoryId===t.targetCategoryId));
  const sourceActive=data.source.status==="ACTIVE";
  return <div className="space-y-6">
    <div className="flex flex-wrap gap-3"><ActionLink variant="secondary" href="/players/participations">Volver a participaciones</ActionLink><ActionLink href={`/players/registrations/${data.registrationId}/documents`}>Abrir expediente del jugador</ActionLink></div>
    <header><h1 className="text-2xl font-semibold text-primary">Participaciones de {data.player.name}</h1><p className="mt-2 leading-7 text-muted">{data.player.club} · {data.player.season}</p></header>
    <section id="origin-eligibility" className="space-y-4 rounded-2xl border border-border bg-surface p-5"><h2 className="text-xl font-semibold text-primary">Categoría de origen</h2><p>{data.player.team} · {data.player.category}</p><p className="text-sm text-muted">{data.source.pathwayCode?`Orden ${data.source.pathwayCode} · Nivel ${data.source.level}`:"Aún no se ha configurado a qué categoría puede subir este jugador."}</p>
      <p className="font-semibold">{sourceActive?"Inscripción de origen activa":data.source.status==="INELIGIBLE"?"Inscripción de origen pendiente de habilitación":"Inscripción de origen no disponible para habilitar"}</p>
      <p className="text-sm leading-6 text-muted">La participación superior conserva esta categoría y el mismo club. No es una promoción definitiva y no permite bajar ni saltar niveles.</p>
      <details open={!sourceActive}><summary className="min-h-12 cursor-pointer font-semibold">Revisar habilitación del origen</summary><EligibilityDecisionForm actorId={data.actorId} endpoint={`/api/player-registrations/${data.registrationId}/approval`} assessment={data.source.assessment} status={data.source.status} allowed={data.source.canApprove} origin /></details>
    </section>
    <section className="space-y-4 rounded-2xl border border-border bg-surface p-5"><h2 className="text-xl font-semibold text-primary">Solicitar categoría superior</h2>
      {data.canRequest?<><p className="text-sm leading-6 text-muted">Elige un equipo del siguiente nivel autorizado. El registro de la solicitud respeta la ventana de lunes a miércoles; la revisión puede realizarse después.</p>
        {!targets.length && <p role="status">No hay equipos de destino disponibles. Revisa el orden para subir, la afiliación y los equipos inscritos del club.</p>}
        <form onSubmit={submit} className="space-y-4"><fieldset disabled={phase!=="EDITING" || !targets.length} className="space-y-4"><div><label htmlFor={`${prefix}-target`} className="block text-sm font-medium">Equipo de la categoría superior</label><SelectField id={`${prefix}-target`} value={target} onValueChange={setTarget} options={targets.map(t=>({value:t.targetId,label:t.targetTeam,description:t.targetCategory}))} required /></div><label className="block text-sm font-medium">Motivo de la solicitud<textarea value={reason} onChange={event=>setReason(event.target.value)} required minLength={10} maxLength={800} className="mt-2 min-h-24 w-full rounded-xl border border-border bg-background p-3" /></label><button className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold">{phase==="SENDING"?"Enviando…":"Solicitar participación superior"}</button></fieldset></form>
        {message && <p role="status">{message}</p>}{phase==="UNCERTAIN" && <div className="flex flex-wrap gap-3"><button type="button" onClick={()=>router.refresh()} className="min-h-12 rounded-xl border border-border px-4 py-3">Consultar solicitudes actuales</button><button type="button" onClick={()=>void send()} className="primary-action min-h-12 rounded-xl px-4 py-3">Reintentar la misma operación</button></div>}
      </>:<p className="text-sm text-muted">El delegado del club presenta la solicitud. Tu cuenta puede revisar los casos autorizados en su alcance.</p>}
    </section>
    <section className="space-y-4"><h2 className="text-xl font-semibold text-primary">Solicitudes y autorizaciones</h2>{!data.participations.length && <p className="rounded-2xl border border-border bg-surface p-5">No hay participaciones superiores solicitadas para este jugador.</p>}
      {data.participations.map(item=><article key={item.id} className="space-y-4 rounded-2xl border border-border bg-surface p-5"><div><h3 className="text-lg font-semibold">{item.targetCategory} · {item.targetTeam}</h3><p className="mt-2 font-semibold">{item.status==="WITHDRAWN"?"Participación retirada":item.sportsEligible?"Autorizada y con condiciones vigentes":item.status==="AUTHORIZED"?"Autorización registrada · Requiere revisar vigencia":"Pendiente de autorización"}</p></div><p className="text-sm leading-6 text-muted">{item.sportsEligible?"Las condiciones para esta participación se comprobaron en esta consulta. La convocatoria y el partido conservan sus propios controles.":"Presentar la solicitud no habilita al jugador. Completa los pendientes de origen y destino antes de autorizarla."}</p>
        {item.assessment && <EligibilityDecisionForm actorId={data.actorId} endpoint={`/api/player-participations/${item.id}/review`} assessment={item.assessment} version={item.version} status={item.status} allowed={item.canReview} />}
      </article>)}
    </section>
  </div>;
}
