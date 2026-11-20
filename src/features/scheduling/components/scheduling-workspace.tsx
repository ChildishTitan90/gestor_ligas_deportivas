"use client";
import { useEffect, useRef, useState } from "react";
import { SelectField } from "@/components/ui/select-field";
import { FormDialog } from "@/components/ui/form-dialog";
import { scheduleRecoveryStore, type PendingSchedule } from "../schedule-recovery.client";
import { PendingReasons } from "./pending-reasons";
import { ProgressSteps } from "./progress-steps";
import type { getSchedulingWorkspace } from "../server/workspace";

type Workspace = Awaited<ReturnType<typeof getSchedulingWorkspace>>;
type Pairing = { round: number; home: string; away: string; factors?: string[] };
type Proposal = {
  teamNames?: Record<string, string>;
  timezone?: string;
  venueNames?: Record<string, string>;
  preferenceOptimal?: boolean;
  partialOptimal?: boolean;
  matches: (Pairing & { venueId: string | null; start: string | null; end: string | null })[];
  byes: { round: number; teamId: string }[];
};
type SavedProposal = { id: string; createdAt: string; proposal: Proposal };
type Result = { ok: boolean; code?: string; proposalId?: string; proposal?: Proposal; conflicts?: Pairing[] };
const messages: Record<string,string> = { APPROVED_SCHEDULING_POLICY_REQUIRED: "Falta aprobar la configuración de generación en el reglamento.", MATCHDAY_COUNT_MISMATCH: "Revisa que las jornadas necesarias estén configuradas y no se traslapen.", DISTRIBUTION_PENDING: "Hay equipos pendientes de asignar a un grupo.", NO_AVAILABLE_SLOT: "Algunos encuentros no tienen un horario viable. Revisa la disponibilidad y los bloqueos de las canchas, los préstamos y las reglas aplicables.", NO_SOLUTION: "No se encontró una combinación para acomodar el calendario completo. Revisa la disponibilidad de las canchas y las restricciones; la lista incluye todos los encuentros considerados.", SEARCH_LIMIT: "La búsqueda alcanzó su límite antes de encontrar una propuesta; esto no significa que sea imposible generarla. Revisa la disponibilidad y vuelve a intentar.", STALE_CONFIGURATION: "La temporada cambió. Actualiza la página antes de volver a generar.", SERVICE_UNAVAILABLE: "No se pudo completar la operación. Puedes volver a intentar con la misma solicitud." };
const factorMessages: Record<string,string> = {
  NO_OPENING:"No se encontró una apertura con tiempo suficiente para esa jornada en las canchas consideradas.",
  VENUE_STAGE:"La configuración de jornadas excluye algunas canchas.",
  FINAL_ROUNDS:"La regla de jornadas finales excluye canchas fuera de la unidad deportiva.",
  DURATION:"La duración configurada no coincide con la de algunas canchas.",
  SANCTION:"Una restricción de participación descarta horarios del encuentro.",
  SEASON_BREAK:"Un descanso de temporada descarta horarios de la jornada.",
  VENUE_BLOCK:"Un bloqueo o mantenimiento descarta horarios de cancha.",
  LOAN_WINDOW:"Falta una ventana de préstamo aprobada que cubra algunos horarios del local.",
  OCCUPIED:"Otros partidos ya programados ocupan los horarios viables de cancha o equipo.",
};
export function SchedulingWorkspace({ workspace }: { workspace: Workspace }) {
  const [seasonId,setSeason] = useState(""); const [groupId,setGroup] = useState("");
  const [dialog,setDialog] = useState(false); const [reason,setReason] = useState("");
  const [pending,setPending] = useState(false); const [uncertain,setUncertain] = useState(false);
  const [payload,setPayload] = useState<PendingSchedule>(); const [result,setResult] = useState<Result>();
  const [recoveryReady,setRecoveryReady] = useState(false);
  const [recoveryError,setRecoveryError] = useState("");
  const [saved,setSaved] = useState<SavedProposal[]>([]);
  const [selectedSaved,setSelectedSaved] = useState("");
  const [savedLoading,setSavedLoading] = useState(false);
  const [savedError,setSavedError] = useState("");
  const [refreshSaved,setRefreshSaved] = useState(0);
  const season=workspace.seasons.find(s=>s.id===seasonId), group=season?.groups.find(g=>g.id===groupId);
  const proposal = result?.proposal;
  const timezone = proposal?.timezone ?? season?.timezone;
  const scheduleTime = timezone ? new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone, dateStyle: "medium", timeStyle: "short", hourCycle: "h23",
  }) : undefined;
  const teamName = (id: string) => proposal?.teamNames?.[id] ?? group?.teamNames[id] ?? "Equipo sin nombre disponible";
  const rounds = [...new Set(proposal?.matches.map(match => match.round))].sort((a, b) => a - b);
  useEffect(() => {
    let active = true;
    scheduleRecoveryStore(workspace.actorId).read().then(saved => {
      if (!active) return;
      if (saved) {
        setPayload(saved);
        setSeason(saved.seasonId);
        setGroup(saved.groupId);
        setReason(saved.reason);
        setUncertain(true);
        setSavedLoading(true);
      }
      setRecoveryReady(true);
    }).catch(() => {
      if (active) setRecoveryError("No se pudo consultar la solicitud pendiente de este navegador. Vuelve a cargar la página.");
    });
    return () => { active = false; };
  }, [workspace.actorId]);
  useEffect(() => {
    if (!seasonId || !groupId) return;
    const controller = new AbortController();
    fetch(`/api/scheduling/proposals?${new URLSearchParams({ seasonId, groupId })}`, {
      signal: controller.signal, cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw new Error("LOAD_FAILED");
      const data = await response.json();
      if (!controller.signal.aborted) setSaved(data.proposals);
    }).catch(() => {
      if (!controller.signal.aborted) setSavedError("No se pudieron consultar las propuestas guardadas.");
    }).finally(() => {
      if (!controller.signal.aborted) setSavedLoading(false);
    });
    return () => controller.abort();
  }, [seasonId, groupId, refreshSaved]);
  const sending = useRef(false);
  async function send() {
    if (sending.current) return;
    const data=payload ?? (season&&group ? {seasonId:season.id,categoryId:group.categoryId,groupId:group.id,operationId:crypto.randomUUID(),expectedSeasonVersion:season.version,reason:reason.trim(),allowPending:true} : undefined);
    if(!data) return;
    sending.current = true;
    setPending(true);
    const store = scheduleRecoveryStore(workspace.actorId);
    try {
      if (!payload) {
        try {
          await store.add(data);
          setPayload(data);
        } catch {
          let existing: PendingSchedule | undefined;
          try {
            existing = await store.read();
          } catch {
            setRecoveryError("No se pudo comprobar la solicitud en este navegador. Vuelve a cargar la página.");
            setRecoveryReady(false);
            return;
          }
          if (existing) {
            setPayload(existing);
            setSeason(existing.seasonId);
            setGroup(existing.groupId);
            setReason(existing.reason);
            setUncertain(true);
          } else {
            setRecoveryError("No se pudo guardar la solicitud en este navegador. Vuelve a cargar la página.");
            setRecoveryReady(false);
          }
          return;
        }
      }
      const response=await fetch("/api/scheduling/generate",{method:"POST",headers:{"Content-Type":"application/json","X-Expected-Actor-Id":workspace.actorId},body:JSON.stringify(data)});
      const body=await response.json();
      const confirmedSuccess = response.ok && body.ok === true && body.proposalId === data.operationId && body.proposal;
      const confirmedConflict = response.ok && body.ok === false && typeof body.code === "string";
      if (!confirmedSuccess && !confirmedConflict) {
        if (!payload && response.status >= 400 && response.status < 500) {
          await store.remove(data.operationId);
          setPayload(undefined);
          setUncertain(false);
          setResult({ok:false,code:body.code});
          setDialog(false);
        } else setUncertain(true);
        return;
      }
      await store.remove(data.operationId);
      setUncertain(false);
      setResult(body);
      if (confirmedSuccess) { setSelectedSaved(""); setSavedLoading(true); setSavedError(""); setRefreshSaved(value => value + 1); }
      setDialog(false);
      setPayload(undefined);
    } catch { setUncertain(true); } finally { sending.current = false; setPending(false); }
  }
  return <div className="space-y-6"><header><p className="text-sm font-semibold uppercase tracking-wider text-muted">Competencias</p><h1 className="mt-2 text-3xl font-bold">Generar calendario</h1><p className="mt-2 text-muted">Selecciona una temporada y un grupo para preparar una propuesta.</p></header>
    <ProgressSteps label="Tu recorrido" current={result?.ok && proposal ? 2 : group ? 1 : 0} steps={[
      {label:"Elegir contexto",detail:season && group ? `${season.name} · ${group.category} · ${group.name}` : "Selecciona temporada, categoría y grupo."},
      {label:"Preparar propuesta",detail:"Genera una nueva o recupera una guardada."},
      {label:"Consultar calendario",detail:"Revisa jornadas y pendientes."},
    ]} />
    <section className="space-y-4 rounded-3xl border border-border bg-surface p-6"><div><label htmlFor="schedule-season" className="font-semibold">Temporada</label><SelectField id="schedule-season" disabled={!recoveryReady || pending || uncertain} value={seasonId} onValueChange={v=>{setSeason(v);setGroup("");setResult(undefined);setSaved([]);setSelectedSaved("");setSavedError("");setSavedLoading(false);}} options={workspace.seasons.map(s=>({value:s.id,label:s.name,description:s.league}))} /></div>
    <div><label htmlFor="schedule-group" className="font-semibold">Categoría y grupo</label><SelectField id="schedule-group" value={groupId} onValueChange={v=>{setGroup(v);setResult(undefined);setSaved([]);setSelectedSaved("");setSavedError("");setSavedLoading(Boolean(v));}} disabled={!recoveryReady || !season || pending || uncertain} options={(season?.groups??[]).map(g=>({value:g.id,label:`${g.category} · ${g.name}`}))} /></div>
    {!workspace.seasons.length&&<p>No hay temporadas disponibles para tu cuenta.</p>}<button className="primary-action" disabled={!recoveryReady || pending || (!group && !uncertain)} onClick={()=>{if (!uncertain) setReason(""); setDialog(true);}}>{uncertain ? "Recuperar propuesta pendiente" : "Generar propuesta"}</button></section>
    {recoveryError && <p role="alert">{recoveryError}</p>}
    {uncertain && !group && <p role="status">Hay una solicitud pendiente de un contexto que ya no está disponible. Puedes reintentarla para consultar su resultado.</p>}
    {group && <section className="space-y-3 rounded-3xl border border-border bg-surface p-6">
      <h2 className="text-xl font-bold">Propuestas guardadas</h2>
      {savedLoading ? <p role="status">Consultando propuestas…</p> : savedError ? <p role="alert">{savedError}</p> :
        saved.length ? <div><label htmlFor="saved-proposal" className="font-semibold">Selecciona una propuesta</label>
          <SelectField id="saved-proposal" value={selectedSaved} disabled={pending || uncertain}
            onValueChange={value => {
              setSelectedSaved(value);
              const selected = saved.find(item => item.id === value);
              if (selected) setResult({ ok: true, proposalId: selected.id, proposal: selected.proposal });
            }}
            options={saved.map(item => ({ value: item.id,
              label: new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short",
                timeZone: season?.timezone }).format(new Date(item.createdAt)),
              description: `${item.proposal.matches.length} partidos · ${item.id.slice(0, 8)}` }))} />
        </div> : <p>No hay propuestas guardadas para este grupo.</p>}
    </section>}
    {result&&!result.ok&&<p role="alert" className="rounded-xl border border-border bg-surface p-4">{messages[result.code??""]??"No se pudo generar la propuesta. Revisa la configuración e inténtalo de nuevo."}</p>}
    {result?.conflicts?.length ? <details className="rounded-xl border border-border bg-surface p-4">
      <summary className="cursor-pointer font-semibold">{result.code === "NO_AVAILABLE_SLOT" ? "Ver encuentros sin horario viable" : "Ver encuentros considerados"} ({result.conflicts.length})</summary>
      <ul className="mt-3 space-y-2">{result.conflicts.map(match => <li key={[match.round, match.home, match.away].join("/")}>
        Jornada {match.round} · Local: {teamName(match.home)} · Visitante: {teamName(match.away)}
        {result.code === "NO_AVAILABLE_SLOT" && match.factors?.some(factor=>factorMessages[factor]) ? <div className="mt-1 text-sm text-muted">
          <p>Factores detectados al revisar las opciones:</p>
          <ul className="list-disc pl-5">{match.factors.filter(factor=>factorMessages[factor]).map(factor=><li key={factor}>{factorMessages[factor]}</li>)}</ul>
        </div> : null}
      </li>)}</ul>
    </details> : null}
    {result?.ok && proposal && <section className="space-y-3 rounded-3xl border border-border bg-surface p-6">
      <h2 className="text-xl font-bold">Propuesta generada</h2>
      <p>{proposal.matches.length} partidos · {proposal.byes.length} descansos</p>
      {proposal.matches.some(match => !match.venueId) ? <p role="status">Hay encuentros pendientes de cancha y horario. Asígnalos antes de aprobar la propuesta.</p> : proposal.preferenceOptimal === false && <p role="status">La búsqueda alcanzó su límite. Puede haber otra propuesta que cumpla más preferencias.</p>}
      {proposal.matches.some(match => !match.venueId) && proposal.partialOptimal === false && <p role="status">La búsqueda alcanzó su límite; podría ser posible programar más encuentros.</p>}
      <p className="text-muted">Pendiente de revisión y publicación. Horarios de la liga ({timezone}).</p>
      {rounds.map(round => <details key={round} className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer font-semibold">Jornada {round}</summary>
        <ul className="mt-2 divide-y divide-border">{proposal.matches.filter(match => match.round === round).map(match =>
          <li key={match.home} className="grid gap-2 py-3 sm:grid-cols-2">
            <span><small className="block text-muted">Local</small>{teamName(match.home)}</span>
            <span><small className="block text-muted">Visitante</small>{teamName(match.away)}</span>
            <span><small className="block text-muted">Cancha</small>{match.venueId ? proposal.venueNames?.[match.venueId] ?? season?.venueNames[match.venueId] ?? "Cancha sin nombre disponible" : "Pendiente"}</span>
            <span><small className="block text-muted">Fecha y horario</small>{match.start && match.end ? scheduleTime?.formatRange(new Date(match.start), new Date(match.end)) : "Pendiente"}</span>
            {!match.venueId && <div className="sm:col-span-2"><PendingReasons factors={match.factors} /></div>}
          </li>)}</ul>
        {proposal.byes.filter(bye => bye.round === round).map(bye =>
          <p key={bye.teamId} className="mt-2 rounded-xl border border-border p-3"><strong>Descansa</strong> · {teamName(bye.teamId)}</p>)}
      </details>)}
    </section>}
    <FormDialog open={dialog} title="Generar propuesta" description={`${season?.name ?? "Temporada"} · ${group?.category ?? "Categoría"} · ${group?.name ?? "Grupo"}. La propuesta se guardará para revisión.`} pending={pending} uncertain={uncertain} dirty={!!reason} onClose={()=>setDialog(false)} footer={<button className="primary-action" disabled={pending||(!uncertain&&reason.trim().length<5)} onClick={send}>{pending?"Generando…":uncertain?"Reintentar la misma solicitud":"Generar"}</button>}>
      <label htmlFor="schedule-reason" className="block font-semibold">Motivo</label><textarea id="schedule-reason" value={reason} disabled={pending||uncertain} onChange={e=>setReason(e.target.value)} maxLength={500} className="mt-2 min-h-28 w-full rounded-xl border border-border bg-surface p-3" />{uncertain&&<p role="alert">No recibimos confirmación. La solicitud se conserva en este navegador. Reintenta la misma solicitud para recuperar el resultado.</p>}
    </FormDialog></div>;
}
