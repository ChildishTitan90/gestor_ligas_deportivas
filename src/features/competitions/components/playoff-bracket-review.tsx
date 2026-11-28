"use client";

import { useEffect, useRef, useState } from "react";
import { SelectField } from "@/components/ui/select-field";
import { PlayoffPenaltiesForm } from "./playoff-penalties-form";

type Preview = { fingerprint: string; groupOrder: string[]; operationId: string; rounds: { number: number; teams: string[]; bracketId?: string; teamIds?: string[] }[] };
const errors: Record<string, string> = {
  PLAYOFF_STANDINGS_CHANGED: "Los resultados cambiaron. Genera y revisa un cuadro actualizado.", PLAYOFF_ALREADY_CONFIRMED: "Esta categoría ya tiene un cuadro confirmado.",
  OFFICIAL_RESULTS_INCOMPLETE: "Faltan resultados oficiales o cédulas confirmadas en la fase regular.", REGULAR_SCHEDULE_INCOMPLETE: "La programación regular está incompleta o excede su fecha límite.",
  UNRESOLVED_STANDINGS: "Hay posiciones empatadas sin resolver. Revisa la clasificación.", PLAYOFF_RULE_REQUIRED: "Falta un reglamento de liguilla aprobado.",
  INSUFFICIENT_TEAMS: "Algún grupo no tiene equipos suficientes.", UNSUPPORTED_GROUP_COUNT: "La liguilla requiere uno, dos, cuatro u ocho grupos.",
  HOME_TEAM_UNDECIDED: "Elige quién será local o cerrará en casa en las llaves con equipos del mismo puesto.", PLAYOFF_MATCHES_ALREADY_CREATED: "Los partidos de cuartos ya fueron creados. Actualiza para consultarlos.",
  PLAYOFF_DATES_REQUIRED: "Faltan las fechas de liguilla en el reglamento aprobado.", INVALID_PLAYOFF_DATES: "Revisa las fechas de liguilla en el reglamento.",
  PLAYOFF_PREVIOUS_ROUND_INCOMPLETE: "Faltan ganadores oficiales de la ronda anterior.",
};
export function PlayoffBracketReview({ seasonId, categoryId }: { seasonId: string; categoryId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [done, setDone] = useState(false);
  const [confirmedRounds, setConfirmedRounds] = useState<Preview["rounds"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [matchesCreated, setMatchesCreated] = useState(false);
  const [choices, setChoices] = useState<Record<string,string>>({});
  const [penaltyCandidates, setPenaltyCandidates] = useState<{bracketId:string;number:number;teams:string[]}[]>([]);
  const [laterRounds,setLaterRounds]=useState<{bracketId:string;number:number;teamIds:(string|null)[];teams:string[];created:boolean}[]>([]);
  const [champion,setChampion]=useState<string|null>(null);
  const guard = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/competitions/playoff-bracket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", seasonId, categoryId }), signal: abort.signal })
      .then(async response => { if (!response.ok) throw Error("read failed"); return response.json(); })
      .then(data => { if (data.confirmed && Array.isArray(data.rounds)) { setConfirmedRounds(data.rounds); setMatchesCreated(Boolean(data.created)); setPenaltyCandidates(Array.isArray(data.penaltyCandidates)?data.penaltyCandidates:[]); setLaterRounds(Array.isArray(data.laterRounds)?data.laterRounds:[]); setChampion(typeof data.champion==='string'?data.champion:null); setDone(true); } })
      .catch(() => { if (!abort.signal.aborted) { setReadFailed(true); setMessage("No se pudo consultar el cuadro confirmado. Actualiza la página para volver a intentar."); } })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [seasonId, categoryId]);
  async function send(action: "preview" | "confirm") {
    if (guard.current || (action === "preview" && uncertain) || (action === "confirm" && !preview)) return;
    guard.current = true; setPending(true); setMessage("");
    try {
      const body = action === "preview" ? { action, seasonId, categoryId } : { action, command: { seasonId, categoryId, fingerprint: preview!.fingerprint, groupOrder: preview!.groupOrder, operationId: preview!.operationId, reason: reason.trim() } };
      const response = await fetch("/api/competitions/playoff-bracket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.status >= 500) throw Error("uncertain");
      const result = await response.json();
      if (!response.ok) { setMessage(response.status === 403 ? "No tienes permiso para esta acción." : errors[result.code] ?? "No se pudo completar la solicitud. Revisa la información."); if (result.code === "PLAYOFF_STANDINGS_CHANGED") setPreview(null); setUncertain(false); return; }
      if (action === "preview") { if (!Array.isArray(result.rounds) || !result.operationId || !result.fingerprint) throw Error("invalid"); setPreview(result); }
      else { if (!result.id) throw Error("uncertain"); setDone(true); setUncertain(false); setMessage("Cuadro confirmado. Actualiza la página para crear los partidos."); setConfirmedRounds(preview!.rounds); }
    } catch { if (action === "confirm") setUncertain(true); setMessage(action === "confirm" ? "No se confirmó el resultado. Reintenta la misma solicitud sin cambiar el motivo." : "No se pudo consultar el cuadro. Intenta de nuevo."); }
    finally { guard.current = false; setPending(false); }
  }
  async function createMatches(round: "quarterfinals"|"semifinals"|"final" = "quarterfinals") {
    if (guard.current || !confirmedRounds) return;
    guard.current=true; setPending(true); setMessage("");
    try {
      const response=await fetch("/api/competitions/playoff-bracket",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"createMatches",command:{seasonId,categoryId,reason:reason.trim(),homeChoices:choices,round}})});
      if(response.status>=500) throw Error("uncertain");
      const result=await response.json();
      if(!response.ok) { setMessage(response.status===403?"No tienes permiso para crear los partidos.":errors[result.code]??"No se pudieron crear los partidos. Revisa las fechas y la localía."); return; }
      if(round==="quarterfinals") setMatchesCreated(true); else setLaterRounds(items=>items.map(item=>round==="semifinals" && item.number>=5 && item.number<=6 || round==="final" && item.number===7 ? {...item,created:true}:item)); setMessage(`Partidos creados: ${result.scheduled ?? 0} con cancha y horario; ${result.pending ?? result.created} pendientes de asignación.`);
    } catch { setMessage("No se confirmó el resultado. Actualiza la página para consultar si se crearon los partidos."); setReadFailed(true); }
    finally { guard.current=false; setPending(false); }
  }
  return <section className="space-y-4 rounded-2xl border border-border bg-surface p-5" aria-labelledby="playoff-review-title">
    <h2 id="playoff-review-title" className="text-xl font-semibold">Revisar liguilla</h2>
    {champion && <p role="status" className="rounded-xl border border-border p-3"><strong>Campeón:</strong> {champion}</p>}
    <p className="text-sm text-muted">El cuadro usa los resultados oficiales de todos los grupos. En cuatro u ocho grupos se propone un sorteo para revisar.</p>
    {loading && <p role="status">Consultando cuadro confirmado…</p>}
    {!done && <button type="button" className="min-h-12 rounded-xl border border-border px-4" disabled={pending || uncertain || loading || readFailed} onClick={() => send("preview")}>{preview ? "Proponer otro cuadro" : "Consultar cuadro"}</button>}
    {(confirmedRounds || preview) && <div className="space-y-4"><h3 className="font-semibold">Cuartos de final {done ? "· Cuadro confirmado" : "· Propuesta"}</h3><ol className="grid gap-3 sm:grid-cols-2">{(confirmedRounds ?? preview!.rounds).map(match => <li key={match.number} className="rounded-xl border border-border p-3"><span className="text-sm text-muted">Llave {match.number}</span><p>{match.teams.join(" vs. ")}</p></li>)}</ol>
      <p className="text-sm">Semifinal 1: ganadores de llaves 1 y 2. Semifinal 2: ganadores de llaves 3 y 4. Los ganadores juegan la final.</p>
      {done && confirmedRounds && confirmedRounds.every(match=>match.bracketId && match.teamIds) && !matchesCreated && <div className="space-y-3"><p>Si ambos equipos terminaron en el mismo puesto, elige quién será local en partido único o cerrará en casa en ida y vuelta. Si tienen distinto puesto se respeta automáticamente al mejor ubicado.</p>
        {confirmedRounds.map(match => match.bracketId && match.teamIds && <div key={match.bracketId}><label htmlFor={`home-${match.bracketId}`}>Localidad por empate de posición · llave {match.number}</label><SelectField id={`home-${match.bracketId}`} value={choices[match.bracketId] ?? ""} options={match.teamIds.map((id,index)=>({value:id,label:match.teams[index]}))} onValueChange={value=>setChoices({...choices,[match.bracketId!]:value})} searchable={false} /></div>)}
        <label className="block">Motivo para crear partidos<textarea className="mt-1 min-h-24 w-full rounded-xl border border-border bg-surface p-3" value={reason} disabled={pending || readFailed} onChange={event=>setReason(event.target.value)} maxLength={500} /></label>
        <button type="button" className="primary-action min-h-12 rounded-xl px-5" disabled={pending || readFailed || reason.trim().length<8} onClick={()=>createMatches("quarterfinals")}>Crear partidos de cuartos</button></div>}
      {done && matchesCreated && <p role="status">Los partidos de cuartos ya fueron creados. Consulta su programación para asignar cancha y horario.</p>}
      {done && matchesCreated && laterRounds.length>0 && <div className="space-y-3"><h3 className="font-semibold">Semifinales y final</h3>{laterRounds.map(item=><div key={item.bracketId} className="rounded-xl border border-border p-3"><p>Llave {item.number} · {item.teams.join(" vs. ")}</p>{!item.created && item.teamIds.every(Boolean) && <div><label htmlFor={`later-${item.bracketId}`}>Si terminaron en el mismo puesto, elige quién cierra en casa</label><SelectField id={`later-${item.bracketId}`} value={choices[item.bracketId]??""} options={item.teamIds.map((id,index)=>({value:id!,label:item.teams[index]}))} onValueChange={value=>setChoices({...choices,[item.bracketId]:value})} searchable={false} /></div>}{item.created && <p className="text-sm text-muted">Partido creado; revisa su programación.</p>}</div>)}
        {laterRounds.some(item=>!item.created && item.teamIds.every(Boolean)) && <><label className="block">Motivo para crear partidos<textarea className="mt-1 min-h-24 w-full rounded-xl border border-border bg-surface p-3" value={reason} disabled={pending||readFailed} onChange={event=>setReason(event.target.value)} maxLength={500} /></label>{laterRounds.filter(item=>!item.created&&item.teamIds.every(Boolean)).some(item=>item.number<=6) && <button type="button" className="primary-action min-h-12 rounded-xl px-5" disabled={pending||readFailed||reason.trim().length<8} onClick={()=>createMatches("semifinals")}>Crear semifinales</button>} {laterRounds.some(item=>item.number===7&&!item.created&&item.teamIds.every(Boolean)) && <button type="button" className="primary-action min-h-12 rounded-xl px-5" disabled={pending||readFailed||reason.trim().length<8} onClick={()=>createMatches("final")}>Crear final</button>}</>}
      </div>}
      {done && penaltyCandidates.length>0 && <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-semibold">Registrar tanda de penales</summary><div className="mt-4 space-y-3">{penaltyCandidates.map(candidate=><PlayoffPenaltiesForm key={candidate.bracketId} seasonId={seasonId} candidate={candidate} onConfirmed={()=>setPenaltyCandidates(items=>items.filter(item=>item.bracketId!==candidate.bracketId))} />)}</div></details>}
      {!done && <><label className="block">Motivo de la aprobación<textarea className="mt-1 min-h-24 w-full rounded-xl border border-border bg-surface p-3" value={reason} disabled={pending || uncertain} onChange={e => setReason(e.target.value)} maxLength={500} /></label><button type="button" className="primary-action min-h-12 rounded-xl px-5" disabled={pending || reason.trim().length < 8} onClick={() => send("confirm")}>{uncertain ? "Reintentar confirmación" : "Confirmar cuadro"}</button></>}
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
