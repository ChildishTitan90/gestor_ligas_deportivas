"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarClock, ClipboardCheck, History, Search, ShieldCheck, UsersRound } from "lucide-react";
import { ActionLink } from "@/components/ui/action-link";
import { SelectField } from "@/components/ui/select-field";
import { assignmentLabels, assessPreview, intervalLabel, normalizeSearch, viewLabels } from "../preview-model";
import type { AssignmentPresentation, AssignmentStatus, PreviewState, RefereePresentation, RefereePreviewData, RefereeView, LiveRefereeControls } from "../types";
import { RefereeDialog } from "./referee-dialog";
import { AssignmentDialog } from "./assignment-dialog";
import {assignmentMatchesNeedingAttention,historyRefereeOptions} from "../assignment-presentation";
import { useCurrentIntervals } from "./use-current-intervals";
import { AvailabilityDialog } from "./availability-dialog";

const secondary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-primary disabled:opacity-50";
const primary = "primary-action inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50";
const panel = "rounded-xl border border-border bg-surface p-4";
const rows = "divide-y divide-border rounded-xl border border-border bg-surface";
const row = "min-w-0 px-4 py-3 sm:px-5";
const rowActions = "flex flex-wrap items-start gap-2";
const rowAction = "inline-flex min-h-11 max-w-full items-center justify-center rounded-lg border border-border px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-soft disabled:opacity-50";
const all = { value: "all", label: "Todos" };

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "positive" | "danger" | "neutral" }) {
  return <span className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold ${tone === "positive" ? "border-positive bg-positive-surface text-positive" : tone === "danger" ? "border-danger bg-danger-surface text-danger" : "border-border bg-background text-muted"}`}>
    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{children}
  </span>;
}
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="min-w-0"><label htmlFor={id} className="mb-2 block text-sm font-semibold">{label}</label>{children}</div>;
}
export function PreviewFeedback({ state, onRetry }: { state: PreviewState; onRetry?: () => void }) {
  const messages = {
    ready: ["", ""], loading: ["Cargando árbitros…", "Preparando los datos sintéticos de esta vista."],
    empty: ["No hay registros para mostrar", "Prueba otra temporada o elimina los filtros. No se crearon datos automáticamente."],
    error: ["No se pudo consultar la información", "Ejemplo de error. La captura visual no equivale a información guardada."],
    denied: ["Acceso denegado", "Ejemplo de falta de permiso o alcance. La interfaz real deberá recibir esta decisión del servidor."],
  };
  return <div className={`${panel} py-12 text-center`} role={state === "error" || state === "denied" ? "alert" : "status"} aria-busy={state === "loading"}>
    <h2 className="text-lg font-semibold">{messages[state][0]}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-muted">{messages[state][1]}</p>
    {onRetry && state !== "loading" && <button type="button" className={`${secondary} mt-5`} onClick={onRetry}>Volver a los datos de ejemplo</button>}
  </div>;
}
type Activity = { id: string; assignmentId: string; matchId: string; refereeId: string; status: AssignmentStatus; at: string };

export function RefereeWorkspace({ initialData, view, matchesHref, live }: { initialData: RefereePreviewData; view: RefereeView; matchesHref: string | null; live?: LiveRefereeControls }) {
  const [localData, setData] = useState(initialData);
  const data = live ? initialData : localData;
  const intervals = useCurrentIntervals(data.availability, Boolean(live) && view === "availability");
  const [leagueId, setLeagueId] = useState(live?.leagueId ?? "");
  const [seasonId, setSeasonId] = useState(live?.seasonId ?? "");
  const [search, setSearch] = useState("");
  const [clubId, setClubId] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [availabilityRef, setAvailabilityRef] = useState("");
  const [historyRef, setHistoryRef] = useState("all");
  const [historyMatch, setHistoryMatch] = useState("all");
  const [scenario, setScenario] = useState<PreviewState>("ready");
  const [editor, setEditor] = useState<{ referee?: RefereePresentation } | null>(null);
  const [review, setReview] = useState<{ assignment?: AssignmentPresentation } | null>(null);
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [availabilityEditor, setAvailabilityEditor] = useState<{id?:string} | null>(null);
  const basePath = live ? `/referees?league=${leagueId}&season=${seasonId}&view=` : "/referees/demo?view=";
  const evaluate = (item: AssignmentPresentation) => live ? live.assessments[item.id] ?? {availability:"UNKNOWN" as const,blockers:[{code:"UNAVAILABLE_ASSESSMENT",message:"Consulta la evaluación actual del servidor."}]} : assessPreview(data,item.matchId,item.refereeId,item.id);
  const confirming = useRef(false);
  useEffect(() => {
    function update() { setOffline(!navigator.onLine); }
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const league = data.leagues.find(item => item.id === leagueId);
  const season = data.seasons.find(item => item.id === seasonId && item.leagueId === leagueId);
  const timezone = league?.timezone ?? "America/Mexico_City";
  const clubs = data.clubs.filter(item => item.seasonId === season?.id);
  const seasonReferees = data.referees.filter(item => data.links.some(link => link.refereeId === item.id && link.seasonId === season?.id));
  const linkFor = (refereeId: string) => data.links.find(link => link.refereeId === refereeId && link.seasonId === season?.id);
  const clubFor = (refereeId: string) => clubs.find(club => club.id === linkFor(refereeId)?.clubId);
  const visibleReferees = seasonReferees.filter(item => (!search || normalizeSearch(`${item.name} ${item.id} ${data.people.find(person => person.id === item.personId)?.reference}`).includes(normalizeSearch(search)))
    && (clubId === "all" || linkFor(item.id)?.clubId === clubId) && (activeFilter === "all" || item.active === (activeFilter === "active")));
  const matches = data.matches.filter(item => item.seasonId === season?.id);
  const assignments = data.assignments.filter(item => matches.some(match => match.id === item.matchId));
  const visibleAssignments = assignments.filter(item => assignmentFilter === "all" || item.status === assignmentFilter);
  const assignmentChoices=assignmentMatchesNeedingAttention(data,season?.id??"",evaluate);
  const currentReferee = seasonReferees.find(item => item.id === availabilityRef);

  function resetFilters() { setSearch(""); setClubId("all"); setActiveFilter("all"); setAvailabilityRef(""); setHistoryRef("all"); setHistoryMatch("all"); setAssignmentFilter("all"); setNotice(""); }
  function openEditor(referee?: RefereePresentation) { confirming.current = false; setEditor({ referee }); }
  function openReview(assignment?: AssignmentPresentation) { confirming.current = false; setReview({ assignment }); }
  async function confirmReferee(value: { personId: string; clubId: string; active: boolean }) {
    if (live) {
      const r = data.referees.find(r => r.personId === value.personId);
      if (await live.mutate({kind:"register",...value,expectedVersion:r?.version ?? data.people.find(p=>p.id===value.personId)?.version ?? 0})) {setEditor(null);setNotice("Registro confirmado por el servidor.");}
      return;
    }
    if (confirming.current) return;
    confirming.current = true;
    const person = data.people.find(item => item.id === value.personId)!;
    const existing = data.referees.find(item => item.personId === value.personId);
    const referee = { id: existing?.id ?? `DEMO-R-${person.id}`, personId: person.id, name: existing?.name ?? person.label.split(" · ")[0], active: value.active };
    setData(previous => ({ ...previous, referees: [...previous.referees.filter(item => item.id !== referee.id), referee],
      links: [...previous.links.filter(item => !(item.refereeId === referee.id && item.seasonId === seasonId)), { refereeId: referee.id, seasonId, clubId: value.clubId }] }));
    setEditor(null); setNotice("Cambio aplicado solo a la demo. No se guardó información real ni se creó una cuenta.");
  }
  async function confirmAssignment(value: { matchId: string; refereeId: string; status: AssignmentStatus }) {
    if (live) {
      const match = data.matches.find(m => m.id === value.matchId)!;
      const command = review?.assignment&&review.assignment.status!=="REVOKED" ? {kind:value.status==="APPROVED"?"approve":"revoke",assignmentId:review.assignment.id,expectedVersion:review.assignment.version,expectedMatchVersion:match.version} : {kind:value.status==="APPROVED"?"assign":"propose",matchId:value.matchId,refereeId:value.refereeId,expectedMatchVersion:match.version};
      if (await live.mutate(command)) {setReview(null);setNotice(command.kind==="assign"?"Árbitro asignado y designación aprobada. Ya puede consultar el partido desde Mis partidos.":command.kind==="propose"?"Propuesta recibida. Queda pendiente de aprobación y no concede acceso al partido.":"Operación confirmada por el servidor. Consulta el estado actualizado de la designación.");}
      return;
    }
    if (confirming.current) return;
    confirming.current = true;
    const assignment = { ...value, id: review?.assignment&&review.assignment.status!=="REVOKED" ? review.assignment.id : `DEMO-A-${crypto.randomUUID()}` };
    setData(previous => ({ ...previous, assignments: [...previous.assignments.filter(item => item.id !== assignment.id), assignment] }));
    setActivity(previous => [...previous, { id: crypto.randomUUID(), assignmentId: assignment.id, matchId: value.matchId, refereeId: value.refereeId, status: value.status, at: new Date().toISOString() }]);
    setReview(null); setNotice(`${assignmentLabels[value.status]} solo en la simulación. No se guardó ni aprobó una designación real.`);
  }

  const historyRows = [
    ...data.history.filter(item => item.seasonId === seasonId).map(item => ({ ...item,
      label: item.identity.source === "UNAVAILABLE" ? "Identidad histórica no disponible" : item.identity.label,
      evidence: item.identity.source === "UNAVAILABLE" ? "Antecedente sin información suficiente. No se completa con la identidad actual ni se atribuye un nombre." : `Identidad preservada al cierre · versión ${item.identity.identityVersion}. Captura: ${intervalLabel(item.identity.capturedAt, item.identity.capturedAt, timezone).split(" → ")[0]}.`,
    })),
    ...(live ? [] : initialData.assignments).filter(item => matches.some(match => match.id === item.matchId)).map(item => ({ ...item, id: `initial-${item.id}`, seasonId, matchLabel: matches.find(match => match.id === item.matchId)?.number ?? "Partido sin referencia", occurredAt: "2026-11-13T18:00:00Z",
      label: `${data.referees.find(referee => referee.id === item.refereeId)?.name ?? "Sin referencia"} · Identidad vigente DEMO`, evidence: "Antecedente sintético inicial de temporada abierta. No acredita identidad al cierre.",
    })),
    ...activity.filter(item => matches.some(match => match.id === item.matchId)).map(item => ({ ...item, seasonId, matchLabel: matches.find(match => match.id === item.matchId)?.number ?? "Sin referencia", occurredAt: item.at,
      label: `${data.referees.find(referee => referee.id === item.refereeId)?.name ?? "Sin referencia"} · Identidad vigente DEMO`, evidence: "Acción simulada en esta visita. Se pierde al recargar; no es auditoría oficial.",
    })),
  ].filter(item => (historyRef === "all" || item.refereeId === historyRef) && (historyMatch === "all" || item.matchId === historyMatch))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return <section className="mx-auto max-w-7xl space-y-4 sm:space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl">Árbitros y designaciones</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Padrón, cobertura por club y revisión de propuestas en un mismo espacio.</p></div>
      {matchesHref && <ActionLink variant="secondary" href={matchesHref}>Mis partidos · Alineación <span aria-hidden="true">↗</span></ActionLink>}
    </div>
    {!live && <aside className="flex gap-3 rounded-2xl border border-accent bg-surface p-4 text-sm">
      <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-accent" size={22} />
      <div><strong className="text-primary">Demostración · Datos sintéticos · Solo desarrollo</strong>
        <p className="mt-1 leading-6 text-muted">Nombres, clubes, partidos y decisiones son ficticios. Las acciones cambian esta visita y se pierden al recargar o salir. No se guarda información real.</p>
        {matchesHref && <p className="mt-1 text-muted">«Mis partidos» abre el recorrido existente con tus permisos y datos reales; no recibe los ejemplos de esta demo.</p>}</div>
    </aside>}
    {live?.error && <div role="alert" className="rounded-xl border border-danger bg-danger-surface p-4 text-sm text-danger">{live.error}{live.uncertain && <button type="button" className={secondary} disabled={live.pending} onClick={live.recover}>Consultar resultado sin reenviar</button>}{live.retryReady && <button type="button" className={secondary} disabled={live.pending} onClick={live.retry}>Reintentar la misma solicitud</button>}</div>}
    {offline && <p role="status" className="rounded-xl border border-border bg-surface p-4 text-sm">Sin conexión. Puedes revisar la demostración ya cargada. No hay cola de sincronización ni guardado local.</p>}
    <div className={`${panel} grid gap-3 sm:grid-cols-2 ${live ? "" : "lg:grid-cols-3"}`}>
      <Field id="referee-league" label="Liga"><SelectField id="referee-league" value={leagueId} onValueChange={value => { if(live){live.onScopeChange(value,"");return;} setLeagueId(value); setSeasonId(""); resetFilters(); }} placeholder="Selecciona una liga"
        options={data.leagues.map(item => ({ value: item.id, label: item.name }))} /></Field>
      <Field id="referee-season" label="Temporada"><SelectField id="referee-season" value={seasonId} disabled={!league} onValueChange={value => { if(live){live.onScopeChange(leagueId,value);return;} setSeasonId(value); resetFilters(); }} placeholder="Selecciona una temporada"
        options={data.seasons.filter(item => item.leagueId === leagueId).map(item => ({ value: item.id, label: item.name }))} /></Field>
      {!live && <Field id="referee-scenario" label="Estado de vista · Simulación"><SelectField id="referee-scenario" value={scenario} onValueChange={value => setScenario(value as PreviewState)} searchable={false}
        options={[{ value: "ready", label: "Datos de ejemplo" }, { value: "loading", label: "Carga" }, { value: "empty", label: "Vacío" }, { value: "error", label: "Error" }, { value: "denied", label: "Acceso denegado" }]} /></Field>}
    </div>
    <nav aria-label="Vistas de arbitraje" className="flex flex-wrap gap-1 border-b border-border pb-2">
      {(Object.entries(viewLabels) as [RefereeView, string][]).map(([key, label]) => <Link key={key} href={`${basePath}${key}`} onClick={event=>{if(live?.pending||live?.uncertain)event.preventDefault();}} aria-current={view === key ? "page" : undefined}
        className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${view === key ? "border-accent bg-soft text-primary" : "border-transparent text-muted hover:bg-surface"}`}>
        {key === "register" ? <UsersRound size={18} aria-hidden="true" /> : key === "availability" ? <CalendarClock size={18} aria-hidden="true" /> : key === "history" ? <History size={18} aria-hidden="true" /> : <ClipboardCheck size={18} aria-hidden="true" />}{label}</Link>)}
    </nav>
    <div role="status" aria-live="polite">{notice && <p className="rounded-xl border border-positive bg-positive-surface p-4 text-sm text-positive">{notice}</p>}</div>
    {scenario !== "ready" ? <PreviewFeedback state={scenario} onRetry={() => setScenario("ready")} /> : !season ? <div className={`${panel} py-12 text-center`}>
      <h2 className="text-lg font-semibold">Elige liga y temporada para comenzar</h2><p className="mt-2 text-sm text-muted">{live ? "Solo se muestran contextos autorizados." : "Selecciona Municipal y Apertura 2026 para los casos de designación. Clausura 2025 muestra los antecedentes históricos."}</p>
    </div> : <>
      {season.closed && <p className="rounded-xl border border-border bg-surface p-4 text-sm">Temporada cerrada · Solo consulta. Abre Historial para ver evidencia preservada y antecedentes incompletos. El estado activo/inactivo del padrón es vigente; no acredita su estado al cierre.</p>}
      {view === "register" && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Padrón de árbitros</h2><p className="mt-1 text-sm text-muted">{visibleReferees.length} de {seasonReferees.length} presentados en esta temporada.</p></div>
          <button type="button" className={primary} disabled={season.closed || !clubs.length || !!live && !live.capabilities.register} onClick={() => openEditor()}>{live ? "Presentar árbitro" : "Presentar árbitro · Demo"}</button></div>
        <div className={`${panel} grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.75fr)_auto]`}>
          <Field id="referee-search" label="Buscar árbitro"><div className="relative"><Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3 top-4 text-muted" />
            <input id="referee-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre o referencia" className="min-h-12 w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-3 text-sm" /></div></Field>
          <Field id="referee-club-filter" label="Club que presenta"><SelectField id="referee-club-filter" value={clubId} onValueChange={setClubId} options={[all, ...clubs.map(item => ({ value: item.id, label: item.name, description: item.code }))]} /></Field>
          <Field id="referee-active-filter" label="Estado"><SelectField id="referee-active-filter" value={activeFilter} onValueChange={setActiveFilter} searchable={false} options={[all, { value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }]} /></Field>
          <button type="button" className={`${secondary} self-end`} onClick={resetFilters}>Limpiar filtros</button>
        </div>
        {!visibleReferees.length ? <PreviewFeedback state="empty" onRetry={resetFilters} /> : <div className={rows}>{visibleReferees.map(referee => {
          const club = clubFor(referee.id);
          const reference = data.people.find(item => item.id === referee.personId)?.reference;
          return <article key={referee.id} className={`${row} grid gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto]`}>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="wrap-anywhere font-semibold text-primary">{referee.name}</h3>
                <Badge tone={referee.active ? "positive" : "neutral"}>{referee.active ? "Activo" : "Inactivo"}</Badge>
              </div>
              <p className="wrap-anywhere text-sm text-muted">{club ? `Presentado por ${club.name} · ${club.code}` : "Club presentador no disponible"}{reference && ` · ${reference}`}</p>
              {!referee.active && <p className="text-sm text-danger">La aprobación requiere que el árbitro esté activo.</p>}
              {live && <details className="text-sm text-muted"><summary className="w-fit cursor-pointer py-1">Referencia de Persona para vincular cuenta</summary>
                <code className="block select-all break-all text-xs">{referee.personId}</code><p className="mt-1 text-xs">Vincula el acceso a esta misma Persona. La incorporación al padrón no crea una cuenta.</p>
              </details>}
            </div>
            <div className={`${rowActions} lg:justify-end`}>
              {live?.capabilities.provisionAccess && !season.closed && data.links.some(link => link.refereeId === referee.id && link.seasonId === season.id) && <Link className={rowAction} href={`/referees/access?referee=${referee.id}&season=${season.id}`} aria-label={`Acceso de árbitro para ${referee.name}`} onClick={event => { if (live.pending || live.uncertain) event.preventDefault(); }}>Acceso de árbitro</Link>}
              <button type="button" className={rowAction} aria-label={`Editar ${referee.name}`} disabled={season.closed || !!live && !live.capabilities.update} onClick={() => openEditor(referee)}>Editar</button>
              <Link href={`${basePath}history`} className={rowAction} aria-label={`Historial de ${referee.name}`} onClick={() => { setHistoryRef(referee.id); setHistoryMatch("all"); }}>Historial</Link>
            </div>
          </article>;
        })}</div>}
      </>}
      {view === "availability" && <>
        <div><h2 className="text-xl font-semibold">Disponibilidad del árbitro</h2><p className="mt-2 text-sm text-muted">Intervalos completos en la zona de la liga: <strong>{timezone}</strong>. El horario del dispositivo no cambia estas fechas.</p></div>
        <div className={panel}><Field id="availability-referee" label="Árbitro"><SelectField id="availability-referee" value={availabilityRef} onValueChange={setAvailabilityRef} options={seasonReferees.map(item => ({ value: item.id, label: item.name, description: clubFor(item.id)?.name }))} /></Field></div>
        {!currentReferee ? <p className={panel}>Selecciona un árbitro para consultar sus intervalos y conflictos.</p> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Intervalos de {currentReferee.name}</h3>
            {live ? <button type="button" className={secondary} disabled={season.closed || !live.capabilities.update} onClick={()=>setAvailabilityEditor({})}>Añadir intervalo</button> : <button type="button" className={secondary} disabled={season.closed} onClick={() => { setData(previous => ({ ...previous, availability: previous.availability.filter(item => item.refereeId !== currentReferee.id) })); setNotice("Se retiraron los intervalos solo de la demo para mostrar disponibilidad sin confirmar. Reinicia la demostración para restaurarlos."); }}>Simular sin intervalos</button>}</div>
          {!intervals.some(item => item.refereeId === currentReferee.id) && <p className={panel}>Sin intervalos vigentes ni próximos. No se presume disponibilidad.</p>}
          <ol className={`${rows} empty:hidden`}>{intervals.filter(item => item.refereeId === currentReferee.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map(item => <li key={item.id} className={`${row} flex flex-wrap items-center justify-between gap-x-4 gap-y-2`}>
            <p className="min-w-0 wrap-anywhere text-sm font-semibold tabular-nums">{intervalLabel(item.startsAt, item.endsAt, timezone)}</p>
            <div className="flex flex-wrap items-center gap-2"><Badge tone={item.available ? "positive" : "danger"}>{item.available ? "Disponible" : "No disponible"}</Badge>{live?.capabilities.update && <button type="button" className={rowAction} aria-label={`Editar intervalo: ${intervalLabel(item.startsAt, item.endsAt, timezone)}`} onClick={() => setAvailabilityEditor({ id: item.id })}>Editar intervalo</button>}</div>
          </li>)}</ol>
          <div className={panel}><h3 className="font-semibold">Conflictos con propuestas y designaciones</h3><p className="mt-2 text-sm text-muted">«No disponible» tiene prioridad en el tramo que coincide con el partido. El intervalo disponible sigue vigente fuera de ese tramo.</p>
            <ul className="mt-3 divide-y divide-border">{assignments.filter(item => item.refereeId === currentReferee.id && item.status !== "REVOKED").map(item => {
              const assessment = evaluate(item);
              return <li key={item.id} className="wrap-anywhere py-2 text-sm"><strong>{matches.find(match => match.id === item.matchId)?.number} · {assignmentLabels[item.status]}</strong>
                <p className="mt-1">{assessment.blockers.length ? assessment.blockers.map(blocker => blocker.message).join(" ") : "Sin conflictos en este ejemplo."}</p></li>;
            })}</ul>
            {!assignments.some(item => item.refereeId === currentReferee.id && item.status !== "REVOKED") && <p className="mt-4 text-sm text-muted">No hay designaciones vigentes para comparar.</p>}
          </div>
        </>}
      </>}
      {view === "quota" && (!live || !season.closed) && <>
        <div><h2 className="text-xl font-semibold">Cuota de árbitros por club</h2><p className="mt-2 text-sm text-muted">Requeridos = equipos registrados ÷ 4, redondeado hacia arriba. No se calculan multas ni consecuencias deportivas.</p></div>
        <p className="rounded-xl border border-border bg-surface p-4 text-sm">{live ? "Conteo actual: inscripciones REGISTERED/ACTIVE, equipo activo y afiliación aprobada del club activo, sin duplicar equipos por temporada. Presentados cuenta relaciones únicas por árbitro/temporada; se muestran los inactivos por separado. Su efecto en cuota sigue pendiente de criterio; no habilitan aprobación." : "El ejemplo compara presentados con requeridos y muestra los activos por separado. Falta confirmar si un estado inactivo modifica el cómputo de la cuota; nunca habilita una aprobación."}</p>
        {!clubs.length ? <PreviewFeedback state="empty" /> : <div className={rows}>{clubs.map(club => {
          const presented = seasonReferees.filter(item => linkFor(item.id)?.clubId === club.id);
          const active = presented.filter(item => item.active).length;
          const required = Math.ceil(club.registeredTeams / 4), missing = Math.max(0, required - presented.length);
          return <article key={club.id} className={`${row} grid gap-x-5 gap-y-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]`}>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h3 className="wrap-anywhere font-semibold text-primary">{club.name}</h3>
                <Badge tone={missing ? "danger" : required ? "positive" : "neutral"}>{missing ? `Faltan ${missing} árbitros` : required ? "Cuota cubierta" : "Sin requerimiento"}</Badge>
              </div>
              <p className="wrap-anywhere text-sm text-muted">{club.code} · {active} activos · {presented.length - active} inactivos</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">{[["Equipos", club.registeredTeams], ["Presentados", presented.length], ["Requeridos", required], ["Faltantes", missing]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="font-semibold tabular-nums text-primary">{value}</dd></div>)}</dl>
            {live && (club.context || club.eligible === false) && <p className="wrap-anywhere text-sm text-muted lg:col-span-2">{club.context}{club.context && club.eligible === false && " · "}{club.eligible === false && "No forma parte del conteo vigente de equipos válidos."}</p>}
          </article>;
        })}</div>}
      </>}
      {view === "assignments" && <>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Propuesta y revisión de designaciones</h2><p className="mt-2 text-sm text-muted">Revisa el grupo completo, la presentación y todos los motivos antes de aprobar.</p></div><button type="button" className={primary} disabled={season.closed || !assignmentChoices.length || !!live && !live.capabilities.update} onClick={() => openReview()}>{live ? live.capabilities.approve ? "Asignar árbitro" : "Proponer designación" : "Proponer designación · Demo"}</button></div>
        {live && <p className="text-sm text-muted">Una propuesta queda pendiente de aprobación. El acceso al partido se habilita con la designación aprobada según los permisos vigentes.</p>}
        {!season.closed&&!assignmentChoices.length&&<p className="text-sm text-muted">No hay partidos abiertos sin árbitro aprobado o con una designación por revisar.</p>}
        <div className={`${panel} sm:max-w-sm`}><Field id="assignment-status-filter" label="Estado de designación"><SelectField id="assignment-status-filter" value={assignmentFilter} onValueChange={setAssignmentFilter} searchable={false} options={[all, ...Object.entries(assignmentLabels).map(([value, label]) => ({ value, label }))]} /></Field></div>
        {!visibleAssignments.length ? <PreviewFeedback state="empty" /> : <div className={rows}>{visibleAssignments.map(item => {
          const match = matches.find(match => match.id === item.matchId)!;
          const assessment = evaluate(item);
          const refereeName = item.displayName ?? data.referees.find(referee => referee.id === item.refereeId)?.name ?? "Árbitro sin referencia";
          const presentingClub = clubFor(item.refereeId)?.name;
          const reviewLabel = item.status === "REVOKED" && !item.historical && !season.closed && match.openForAssignments !== false && (!live || live.capabilities.update) ? "Actualizar designación" : "Revisar";
          return <article key={item.id} className={`${row} grid gap-x-5 gap-y-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_16.5rem]`}>
            <div className="min-w-0 space-y-1 wrap-anywhere">
              <h3 className="font-semibold text-primary">{match.home} – {match.away}</h3>
              <p className="text-xs text-muted">{match.number} · {match.category} · Grupo {match.group}</p>
              <p className="text-sm tabular-nums text-muted">{intervalLabel(match.startsAt, match.endsAt, timezone)} · {timezone}</p>
            </div>
            <div className="min-w-0 space-y-1 wrap-anywhere">
              <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{refereeName}</p>
                <Badge tone={item.status === "APPROVED" ? "positive" : "neutral"}>{assignmentLabels[item.status]}</Badge></div>
              <p className="text-sm text-muted">{presentingClub && `${presentingClub} · `}{assessment.availability === "COVERED" ? "Horario cubierto" : assessment.availability === "UNAVAILABLE" ? "No disponible en ese horario" : "Disponibilidad sin confirmar"}</p>
            </div>
            <div className={`${rowActions} sm:col-span-2 xl:col-span-1 xl:justify-end`}>
              <button type="button" className={rowAction} aria-label={`${reviewLabel} ${match.number} · ${refereeName}`} onClick={() => openReview(item)}>{reviewLabel}</button>
              <Link href={`${basePath}history`} className={rowAction} aria-label={`Historial de ${match.number}`} onClick={() => { setHistoryRef("all"); setHistoryMatch(match.id); }}>Historial</Link>
            </div>
            <div className="min-w-0 wrap-anywhere sm:col-span-2 xl:col-span-3">
              {item.status === "REVOKED" ? <p className="text-sm text-muted">Antecedente revocado. No ocupa el horario.</p> : assessment.blockers.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-danger">{assessment.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.message}</li>)}</ul> : <p className="text-sm text-positive">{live ? "Sin bloqueos actuales." : "Sin bloqueos en el ejemplo."}</p>}
            </div>
          </article>;
        })}</div>}
        <aside className={`${panel} text-sm leading-6`}><h3 className="font-semibold">Decisión pendiente: grupo único</h3><p className="mt-2 text-muted">{live ? "La restricción se aplica también al grupo único. Puede dejar sin candidatos a los clubes representados; no existe una excepción automática." : "En D-103 todos los clubes del ejemplo tienen un equipo en el mismo grupo. Aplicar la restricción a todo el grupo deja sin árbitros elegibles de esos clubes. Propón D-103 para revisar el bloqueo; no se ha supuesto ninguna excepción."}</p></aside>
      </>}
      {view === "history" && <>
        <div><h2 className="text-xl font-semibold">Historial por árbitro y partido</h2><p className="mt-2 text-sm text-muted">Las identidades del cierre se presentan desde su evidencia, sin sustituirlas por nombres actuales.</p></div>
        <div className={`${panel} grid gap-4 sm:grid-cols-2`}>
          <Field id="history-referee" label="Referencia de árbitro"><SelectField id="history-referee" value={historyRef} onValueChange={setHistoryRef} descriptionPosition="below" aria-describedby="history-referee-help" options={[all, ...historyRefereeOptions(data,seasonId)]} /><p id="history-referee-help" className="mt-2 text-xs text-muted">El UUID identifica al árbitro. Los antecedentes cerrados conservan su identidad capturada; los nombres vigentes no completan una identidad histórica faltante.</p></Field>
          <Field id="history-match" label="Partido"><SelectField id="history-match" value={historyMatch} onValueChange={setHistoryMatch} options={[all, ...matches.map(item => ({ value: item.id, label: `${item.number} · ${item.home} – ${item.away}` })), ...data.history.filter(item => item.seasonId === seasonId).map(item => ({ value: item.matchId, label: item.matchLabel }))]} /></Field>
        </div>
        {live && <ol className={`${rows} empty:hidden`}>{data.events?.filter(e=>(historyRef==="all"||e.refereeId===historyRef)&&(historyMatch==="all"||data.assignments.some(a=>a.id===e.assignmentId&&a.matchId===historyMatch))).map(e=><li key={e.id} className={`${row} space-y-1 wrap-anywhere`}><h3 className="font-semibold">{({register:"Registro de árbitro",availability:"Disponibilidad",propose:"Propuesta",approve:"Aprobación",revoke:"Revocación"} as Record<string,string>)[e.action]??e.action} · @{e.actor}</h3><p className="text-sm">{e.reason}</p><p className="text-xs text-muted">{e.refereeId} · Versión {e.version} · {intervalLabel(e.at,e.at,timezone).split(" → ")[0]} · {timezone}</p></li>)}</ol>}
        {!historyRows.length ? <PreviewFeedback state="empty" /> : <ol className={rows}>{historyRows.map(item => <li key={item.id} className={`${row} space-y-1 wrap-anywhere`}>
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 font-semibold">{item.label}</h3><Badge tone={item.status === "APPROVED" ? "positive" : "neutral"}>{assignmentLabels[item.status]}</Badge></div>
          <p className="text-xs text-muted">{item.matchLabel} · {season.name} · {intervalLabel(item.occurredAt, item.occurredAt, timezone).split(" → ")[0]} · {timezone}</p>
          <p className="text-sm text-muted">{item.evidence}</p><p className="text-xs text-muted">Referencia: {item.refereeId}</p>
        </li>)}</ol>}
      </>}
      {live && view==="quota" && season.closed && <p className={panel}>No se reconstruye una cuota histórica con el estado actual de clubes o árbitros. Consulta los antecedentes conservados.</p>}
    </>}
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5 text-sm text-muted"><p>{live ? "Arbitraje · Operaciones sujetas a permiso, versión y confirmación del servidor." : "PDGLD-86 / PDGLD-142 · Revisión de interfaz. Sin escrituras ni proveedores externos."}</p>
      {!live && <button type="button" className={secondary} onClick={() => { setData(initialData); setActivity([]); setScenario("ready"); resetFilters(); setNotice("Demostración reiniciada con los datos sintéticos iniciales."); }}>Reiniciar demostración</button>}</footer>
    {editor && season && <RefereeDialog data={data} seasonId={season.id} referee={editor.referee} live={live} onClose={() => setEditor(null)} onConfirm={confirmReferee} />}
    {review && season && <AssignmentDialog key={review.assignment?.id??"new"} data={data} seasonId={season.id} timezone={timezone} assignment={review.assignment} live={live} onReviewExisting={assignment=>{setReview({assignment});}} onClose={() => setReview(null)} onConfirm={confirmAssignment} />}
    {live && currentReferee && availabilityEditor && <AvailabilityDialog referee={currentReferee} interval={data.availability.find(i=>i.id===availabilityEditor.id)} timezone={timezone} live={live} onClose={()=>setAvailabilityEditor(null)} />}
  </section>;
}
