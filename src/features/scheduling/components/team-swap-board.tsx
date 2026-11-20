"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { venueLocalTime } from "@/features/venues/time";
import { proposeTeamSwap } from "../team-swap";
import { setPendingTeamSwaps } from "./pending-team-swaps";
import { PendingReasons } from "./pending-reasons";
import { GeneratedEncounterDraft } from "./generated-encounter-draft";
import { actionButton, sendSchedulingRequest } from "./scheduling-request";

type Match = { encounterIndex:number; round:number; matchdayId:string; homeId:string; awayId:string; home:string; away:string;
  venueId:string|null; venue:string; start:string|null; end:string|null; reservedUntil:string|null; factors:string[] };
type Choice = { id:string; round:number };

export function TeamSwapBoard({matches,byes,actorId,proposalId,version,canEdit,timeZone,venues}: {
  matches:Match[]; byes:{round:number;teamId:string;team:string}[]; actorId:string; proposalId:string; version:number;
  canEdit:boolean; timeZone:string; venues:{value:string;label:string}[];
}) {
  const router=useRouter();
  const [selected,setSelected]=useState<Choice|null>(null);
  const [swaps,setSwaps]=useState<{round:number;first:string;second:string}[]>([]);
  const [saved,setSaved]=useState(false);
  const [message,setMessage]=useState("");
  const [pending,setPending]=useState(false);
  const drag=useRef<Choice|null>(null), busy=useRef(false);
  useEffect(()=>{
    const dirty=swaps.length>0 && !saved;
    setPendingTeamSwaps(proposalId,dirty);
    const warn=(event:BeforeUnloadEvent)=>{if(dirty)event.preventDefault();};
    window.addEventListener("beforeunload",warn);
    return ()=>{window.removeEventListener("beforeunload",warn);setPendingTeamSwaps(proposalId,false);};
  },[proposalId,swaps,saved]);
  const names=useMemo(()=>new Map(matches.flatMap(match=>[[match.homeId,match.home],[match.awayId,match.away]])),[matches]);
  const fixtures=useMemo(()=>matches.map(match=>({round:match.round,matchdayId:match.matchdayId,home:match.homeId,away:match.awayId})),[matches]);
  const current=useMemo(()=>swaps.reduce((items,swap)=>
    proposeTeamSwap(items,swap.round,swap.first,swap.second).map(item=>({...item.before,home:item.home,away:item.away})),fixtures),[fixtures,swaps]);
  const displayMatches=matches.map((match,index)=>{
    const next=current[index], changed=next.home!==match.homeId || next.away!==match.awayId;
    return {...match,homeId:next.home,awayId:next.away,home:names.get(next.home) ?? match.home,away:names.get(next.away) ?? match.away,
      ...(changed ? {venueId:null,venue:"Pendiente",start:null,end:null,reservedUntil:null,factors:["TEAM_CHANGED"]} : {})};
  });
  const displayByes=byes.map(bye=>{
    const teamId=swaps.reduce((id,swap)=>id===swap.first ? swap.second : id===swap.second ? swap.first : id,bye.teamId);
    return {...bye,teamId,team:names.get(teamId) ?? bye.team};
  });
  const format=new Intl.DateTimeFormat("es-MX",{dateStyle:"medium",timeStyle:"short",timeZone});
  const rounds=[...new Set([...matches.map(m=>m.round),...byes.map(b=>b.round)])].sort((a,b)=>a-b);

  function choose(source:Choice,target:Choice) {
    if(source.id===target.id){setSelected(null);return;}
    if(source.round!==target.round){setMessage("Elige dos equipos de partidos diferentes de la misma jornada.");setSelected(null);return;}
    try {
      const next=proposeTeamSwap(current,source.round,source.id,target.id).map(item=>({...item.before,home:item.home,away:item.away}));
      if(swaps.length>=50){setMessage("Guarda los cambios antes de continuar editando.");setSelected(null);return;}
      if(next.every((item,index)=>item.home===fixtures[index].home && item.away===fixtures[index].away)) setSwaps([]);
      else setSwaps([...swaps,{round:source.round,first:source.id,second:target.id}]);
      setMessage("Jornadas actualizadas.");
    } catch {setMessage("Elige equipos de partidos diferentes de la misma jornada.");}
    setSelected(null);
  }
  function team(id:string,name:string,round:number) {
    if(!canEdit) return <span>{name}</span>;
    const choice={id,round};
    return <button type="button" draggable={!pending && !saved} disabled={pending || saved} aria-pressed={selected?.id===id && selected.round===round}
      aria-label={`Intercambiar ${name}, jornada ${round}`}
      onClick={()=>selected ? choose(selected,choice) : (setSelected(choice),setMessage(`Selecciona otro equipo de la jornada ${round}.`))}
      onDragStart={event=>{drag.current=choice;event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",id);}}
      onDragOver={event=>{if(drag.current?.round===round)event.preventDefault();}}
      onDrop={event=>{event.preventDefault();if(drag.current)choose(drag.current,choice);drag.current=null;}}
      onDragEnd={()=>{drag.current=null;}}
      className={`inline-flex min-h-11 items-center gap-1 rounded-lg border px-2 text-left ${selected?.id===id && selected.round===round ? "border-accent bg-background" : "border-border"} cursor-grab`}>
      <GripVertical size={16} aria-hidden="true" />{name}</button>;
  }
  async function save() {
    if(!swaps.length || busy.current || saved)return;
    busy.current=true;setPending(true);setMessage("");
    try {
      const outcome=await sendSchedulingRequest("/api/scheduling/team-swap",actorId,
        {proposalId,expectedVersion:version,swaps,reason:"Intercambio manual de equipos"},"ADJUSTMENT_SAVED");
      if(outcome.error){setMessage(outcome.error);return;}
      setSaved(true);setMessage("Cambios guardados. Revisa las canchas y horarios pendientes.");router.refresh();
    } catch {setMessage("No se confirmó el resultado. Actualiza la propuesta antes de volver a intentarlo.");}
    finally {busy.current=false;setPending(false);}
  }

  return <>
    {canEdit && <p className="text-sm text-muted">Arrastra un equipo sobre otro de la misma jornada o selecciónalos uno por uno. Verás los cambios antes de guardarlos.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {swaps.length>0 && !saved && <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
      <p>Los cambios aún no se guardan. Las canchas y horarios de los encuentros modificados quedarán pendientes.</p>
      <button type="button" className={actionButton} disabled={pending} onClick={save}>{pending ? "Validando…" : "Guardar cambios"}</button>
    </div>}
    {rounds.map(round=><section key={round} className="rounded-2xl border border-border bg-background p-4" aria-label={`Jornada ${round}`}>
      <h3 className="text-lg font-semibold">Jornada {round}</h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">{displayMatches.filter(match=>match.round===round).map(match=><li key={match.encounterIndex} className="rounded-xl border border-border bg-surface p-4">
        <p className="text-xs font-semibold uppercase text-muted">Encuentro</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 font-semibold">{team(match.homeId,match.home,round)} <span className="text-muted">vs.</span> {team(match.awayId,match.away,round)}</div>
        <p className="mt-2 text-sm text-muted">{match.venueId ? "Cancha y horario asignados" : "Cancha y horario pendientes"}</p>
        <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-primary">Ver detalles</summary>
          <div className="mt-3 space-y-2 text-sm"><p>Cancha: {match.venue}</p>
            {match.start && match.end && match.reservedUntil ? <><p>Horario: {format.format(new Date(match.start))} – {format.format(new Date(match.end))}</p><p className="text-muted">Cancha ocupada hasta {format.format(new Date(match.reservedUntil))}</p></> : <p>Horario pendiente</p>}
            {!match.venueId && <PendingReasons factors={match.factors} />}
            {canEdit && swaps.length>0 && !saved && <p>Guarda los cambios de equipos para ajustar la cancha y el horario.</p>}
            {canEdit && swaps.length===0 && <GeneratedEncounterDraft key={`${actorId}:${version}:${match.encounterIndex}`} actorId={actorId} proposalId={proposalId} version={version}
              encounterIndex={match.encounterIndex} timeZone={timeZone} context={`Jornada ${round} · ${match.home} vs. ${match.away}`}
              initialVenueId={match.venueId ?? ""} initialStart={match.start ? venueLocalTime(new Date(match.start),timeZone).slice(0,16) : ""} venues={venues} />}
          </div>
        </details>
      </li>)}</ul>
      {displayByes.filter(bye=>bye.round===round).map((bye,index)=><p key={index} className="mt-3 text-sm">Descansa: {bye.team}</p>)}
    </section>)}

  </>;
}
