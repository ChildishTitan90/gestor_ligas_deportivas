"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ClipboardCheck, ClipboardPenLine, FlaskConical, LoaderCircle, LockKeyhole, Plus, Save } from "lucide-react";
import { ActionLink } from "@/components/ui/action-link";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { createReportClient, ReportClientError } from "../report-client";
import { updateDraftLineup } from "../lineup-draft";
import { capturedScore } from "../score";
import { jerseyErrors, lineupSealIssues } from "../lineup-rules";
import { advanceMatchClock, clockReading, type ClockAction } from "../match-clock";
import { ReportClock, type ClockDialog } from "./report-clock";
import type { ReportReceipt } from "../contract";
import { reportErrorMessage } from "../feedback";
import { REPORT_DEMO_PATH } from "../demo-data";
import { reviewReportPresentation } from "../presentation-review";
import type { CaptainSignature, MatchReportPresentation, ReportDemoData, ReportLineup } from "../types";
import { ReportClosing } from "./report-closing";
import { EventDialog, PeriodDialog } from "./report-entry-dialogs";
import { ReportEvents } from "./report-events";
import { ReportLineups } from "./report-lineups";
import { ReportParticipation } from "./report-participation";
import { MatchHeader, primaryButton, ReportNotice, secondaryButton, SectionHeading } from "./report-shared";
import { ReportSummary } from "./report-summary";
import { currentPitch, teamTactics, type TeamTactics } from "../tactics";
import type { SlotAssignment } from "./report-tactics";
import { PlayerActionsDialog } from "./player-actions-dialog";
import type { ReportEvent } from "../types";

type OperationState = "idle" | "dirty" | "saving" | "saved" | "error" | "stale" | "uncertain" | "denied";
type ResponseMode = "success" | "error" | "stale" | "uncertain" | "denied";
type DemoOperation = {
  id: string; kind: "save" | "lock-lineups" | "clock" | "confirm"; clockAction?: ClockAction; expectedReportVersion: number; expectedMatchVersion: number;
  snapshot: MatchReportPresentation;
};
const steps = ["Alineaciones", "Participación", "Eventos", "Cierre y firmas", "Resumen"];
const responseOptions = [
  { value: "success", label: "Respuesta correcta" }, { value: "error", label: "Error conocido · Sin cambios" },
  { value: "stale", label: "Versión obsoleta" }, { value: "uncertain", label: "Resultado incierto" },
  { value: "denied", label: "Pérdida de permiso" },
];

export function ReportWorkspace({ data, live }: { data: ReportDemoData; live?: { actorId: string } }) {
  const [client] = useState(() => live ? createReportClient(live.actorId, data) : null);
  const [match, setMatch] = useState(data.match);
  // Abrir una cédula anterior no añade posiciones ni cambia el contenido firmado.
  // La formación y el uniforme se incorporan al aplicarlos explícitamente.
  const [report, setReport] = useState(data.report);
  const [savedReport, setSavedReport] = useState(data.report);
  const [stage, setStage] = useState((live && !data.match.status.captureAllowed) || data.scenario === "confirmed" || data.scenario === "stale" || data.scenario === "uncertain" ? 4 : -1);
  const [viewState, setViewState] = useState(["denied", "loading", "error"].includes(data.scenario) ? data.scenario : "ready");
  const [state, setState] = useState<OperationState>(data.scenario === "stale" ? "stale" : data.scenario === "uncertain" ? "uncertain" : "idle");
  const [response, setResponse] = useState<ResponseMode>("success");
  const [operation, setOperation] = useState<DemoOperation | null>(data.scenario === "uncertain" || data.scenario === "stale" ? {
    id: "demo-operation-018", kind: "save", expectedReportVersion: data.report.version, expectedMatchVersion: data.match.version, snapshot: data.report,
  } : null);
  const [lineupConfirm, setLineupConfirm] = useState(false);
  const [lineupAccepted, setLineupAccepted] = useState(false);
  const [clockDialog, setClockDialog] = useState<ClockDialog>(null);
  const [captureMode, setCaptureMode] = useState<"live" | "posterior">(live ? "live" : "posterior");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [signatureEpoch, setSignatureEpoch] = useState(0);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState(data.confirmation);
  const [periodEditor, setPeriodEditor] = useState<{ playerId: string; index: number | null } | null>(null);
  const [eventEditor, setEventEditor] = useState<{ id?: string; changeOnly?: boolean; initial?: Partial<ReportEvent> } | null>(null);
  const [actionPlayer, setActionPlayer] = useState<string | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const confirmed = report.status === "CONFIRMED";
  const confirmationUnavailable = Boolean(live && confirmation?.available !== true);
  const confirmationMessage = confirmation?.message ?? reportErrorMessage("CONFIRMATION_DEPENDENCIES_PENDING");
  const locked = confirmed || !match.status.captureAllowed || ["saving", "stale", "uncertain", "denied"].includes(state);
  const sealed = Boolean(report.lineupsLock) || confirmed;
  const sealIssues = lineupSealIssues(data, report);
  const invalidJerseys = Object.keys(jerseyErrors(data, report)).length > 0;
  const eventLocked = locked || !sealed || match.status.code !== "IN_PROGRESS";
  const issues = reviewReportPresentation(data, report);
  const captureInMemory = stage >= 0 && !confirmed && (!live || ["dirty", "saving", "uncertain", "stale", "error", "denied"].includes(state));
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!captureInMemory) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [captureInMemory]);

  function move(next: number) {
    if (next > 0 && !sealed && !confirmed && match.status.captureAllowed) { setLineupAccepted(false); setLineupConfirm(true); return; }
    setStage(next);
    requestAnimationFrame(() => { panelHeading.current?.focus(); panelHeading.current?.scrollIntoView({ block: "start" }); });
  }
  function edit(update: (current: MatchReportPresentation) => MatchReportPresentation) {
    if (locked || busy.current) return;
    const hadSignatures = Object.values(report.signatures).some(Boolean);
    setReport(current => ({ ...update(current), signatures: Object.fromEntries([match.home.id, match.away.id].map(id => [id, null])) }));
    if (hadSignatures) { setSignatureEpoch(value => value + 1); setMessage("Cambió la captura. Se retiraron ambas firmas; vuelve a solicitarlas antes de confirmar."); }
    else setMessage("Cambios pendientes en esta página. Se perderán al recargar o salir.");
    setState("dirty"); setOperation(null);
  }
  function lineup(playerId: string, changes: Partial<ReportLineup>) {
    if (sealed && Object.keys(changes).some(key => key !== "periods")) return;
    if (sealed) { edit(current => ({...current,lineups:current.lineups.map(row=>row.playerId===playerId?{...row,...changes}:row)})); return; }
    edit(current => updateDraftLineup(data,current,playerId,changes));
  }

  function tactics(teamId: string, value: TeamTactics, assignment?: SlotAssignment) {
    if (sealed) return;
    edit(current => ({ ...current, tactics: { ...current.tactics, [teamId]: value }, lineups: current.lineups.map(row => {
      if (!data.players.some(p => p.id === row.playerId && p.teamId === teamId)) return row;
      const starter = value.slots.some(s => s.playerId === row.playerId);
      return { ...row, starter, selected: row.selected || starter, ...(assignment?.playerId === row.playerId ? { matchJersey: assignment.jersey } : {}) };
    }) }));
  }
  function saveEvent(event: ReportEvent) {
    const events = report.events.some(item => item.id === event.id) ? report.events.map(item => item.id === event.id ? event : item) : [...report.events, event];
    const next = { ...report, events, score: capturedScore(events,match.home.id,match.away.id), signatures: Object.fromEntries([match.home.id, match.away.id].map(id => [id, null])) };
    edit(() => next); setEventEditor(null);
    if (live && stage === 0 && captureMode === "live") runOperation("save", undefined, next);
  }
  function removeEvent(id: string) {
    edit(current => {
      const events = current.events.filter(event => event.id !== id);
      return { ...current, events, ...(current.events.find(event => event.id === id)?.typeCode && ["GOAL","OWN_GOAL"].includes(current.events.find(event=>event.id===id)!.typeCode) ? { score: capturedScore(events,match.home.id,match.away.id) } : {}) };
    });
  }
  function moveEvent(id: string, direction: -1 | 1) {
    edit(current => {
      const events = [...current.events]; const index = events.findIndex(e => e.id === id); const next = index + direction;
      if (index < 0 || next < 0 || next >= events.length) return current;
      [events[index], events[next]] = [events[next], events[index]];
      return { ...current, events };
    });
  }
  function signature(teamId: string, value: CaptainSignature | null) {
    if (locked || busy.current) return;
    setReport(current => ({ ...current, signatures: { ...current.signatures, [teamId]: value } }));
    setState("dirty"); setOperation(null);
    setMessage(value ? "Firma confirmada en esta captura. Falta guardar y recibir el acuse." : "Firma pendiente.");
  }
  function finishSuccess(op: DemoOperation, receipt?: ReportReceipt) {
    const next: MatchReportPresentation = { ...structuredClone(op.snapshot), version: receipt?.reportVersion ?? op.expectedReportVersion + 1,
      status: op.kind === "confirm" ? "CONFIRMED" : "DRAFT", confirmedAt: op.kind === "confirm" ? new Date().toISOString() : null };
    if (receipt?.lineupsLock) next.lineupsLock = receipt.lineupsLock;
    if (receipt?.clock) next.clock = receipt.clock;
    if (!receipt && op.kind === "clock" && op.clockAction) next.clock = advanceMatchClock(next.clock ?? null, op.clockAction, new Date().toISOString());
    if (!receipt && op.kind === "lock-lineups") next.lineupsLock = { operationId: op.id, lockedAt: new Date().toISOString() };
    if (op.kind === "lock-lineups") { setLineupConfirm(false); setLineupAccepted(false); }
    if (receipt) setMatch(current => ({ ...current, version: receipt.matchVersion, ...(op.clockAction?.type === "start" ? { status: { code: "IN_PROGRESS", label: "En curso", captureAllowed: true } } : {}) }));
    if (receipt) {
      next.id = receipt.reportId;
      for (const [teamId, fileId] of Object.entries(client?.signatureReferences(op.id) ?? {})) if (fileId && next.signatures[teamId]) next.signatures[teamId] = { ...next.signatures[teamId]!, image: `/api/match-reports/${match.id}/signatures/${fileId}` };
    }
    setReport(next); setSavedReport(next); setState("saved"); setOperation(null);
    if (op.kind === "confirm") { setMatch(current => ({ ...current, status: { code: "FINISHED", label: "Finalizado", captureAllowed: false } })); move(4); }
    if (live) { setMessage("Acuse recibido del servidor. Cédula v" + next.version + "."); return; }
    setMessage(op.kind === "confirm" ? "Confirmación simulada recibida. Edición normal deshabilitada; no hay resultado oficial." : "Guardado simulado recibido. La copia solo vive en memoria y se pierde al salir o recargar.");
  }
  function runOperation(kind: DemoOperation["kind"], retry?: DemoOperation, snapshot?: MatchReportPresentation, clockAction?: ClockAction) {
    if (kind === "confirm" && confirmationUnavailable) return;
    if (invalidJerseys || (kind === "lock-lineups" && sealIssues.length) || busy.current || (locked && !(live && retry && state === "uncertain")) || (kind === "confirm" && issues.length > 0)) return;
    busy.current = true;
    const next = retry ?? { id: crypto.randomUUID(), kind, expectedReportVersion: report.version, expectedMatchVersion: match.version, snapshot: structuredClone(snapshot ?? report), ...(clockAction ? { clockAction } : {}) };
    setOperation(next); setState("saving"); setMessage("Esperando respuesta simulada. No se envía ninguna solicitud.");
    if (client) {
      setMessage("Enviando la operación al servidor. Cerrar no cancela el envío.");
      void client.send(next).then(receipt => finishSuccess(next, receipt)).catch(error => {
        if (error instanceof ReportClientError && error.code === "CONFIRMATION_DEPENDENCIES_PENDING") { const message = reportErrorMessage(error.code); setConfirmation({ available: false, message }); setState("error"); setMessage(message); }
        else if (error instanceof ReportClientError && error.code === "STALE_VERSION") { setState("stale"); setMessage("La versión cambió. Se conserva tu captura; consulta la vigente antes de rehacerla."); }
        else if (error instanceof ReportClientError && error.status === 403) { setState("denied"); setMessage("El servidor denegó el acceso. No se descartó tu captura."); }
        else if (error instanceof ReportClientError && error.status < 500) { setState("error"); setMessage(reportErrorMessage(error.code)); }
        else { setState("uncertain"); setMessage("No se recibió un acuse. Consulta la operación antes de volver a enviarla."); }
      }).finally(() => { busy.current = false; setConfirmOpen(false); setAccepted(false); });
      return;
    }
    const outcome = response;
    timer.current = setTimeout(() => {
      busy.current = false;
      setConfirmOpen(false); setAccepted(false);
      if (outcome === "success") finishSuccess(next);
      else { setState(outcome); setMessage(outcome === "error" ? "Error simulado: la operación no se aplicó. Puedes corregir la captura o reintentar la misma operación." : ""); }
    }, 750);
  }
  function queryResult(applied: boolean) {
    if (!operation || state !== "uncertain") return;
    if (client) {
      if (busy.current) return;
      busy.current = true;
      void client.query(operation.id).then(result => {
        if (result.status === "APPLIED" && result.receipt) finishSuccess(operation, result.receipt);
        else setMessage("Aún no hay acuse para esta operación. Puedes consultar otra vez o reenviar exactamente la misma intención; no se genera otra clave.");
      }).catch(() => setMessage("No se pudo consultar el acuse. Se conserva la operación pendiente.")).finally(() => { busy.current = false; });
      return;
    }
    if (applied) finishSuccess(operation);
    else { setState("error"); setMessage("Consulta simulada: la operación no se aplicó. Se conserva su contenido y versión para un reintento manual."); }
  }
  const operationText = live ? (state === "saved" ? "Guardado con acuse del servidor" : state === "saving" ? "Esperando acuse" : state === "uncertain" ? "Resultado incierto" : state === "stale" ? "Versión obsoleta" : state === "denied" ? "Acceso denegado" : state === "idle" ? (report.version ? "Borrador guardado" : "Cédula sin guardar") : "Cambios pendientes") : state === "saving" ? "Esperando respuesta simulada…" : state === "saved" ? "Guardado simulado · Solo memoria" : state === "dirty" ? "Cambios sin guardar · Solo memoria" : state === "error" ? "Error simulado · Sin aplicar" : state === "stale" ? "Versión obsoleta · Captura conservada" : state === "uncertain" ? "Resultado incierto · Sin reenviar" : state === "denied" ? "Permiso perdido · Edición bloqueada" : confirmed ? "Solo consulta · Ejemplo" : "Borrador de ejemplo";

  return <div className="space-y-5" data-report-workspace="">
    <div className="flex flex-wrap items-center justify-between gap-3"><ActionLink href={live ? "/matches" : REPORT_DEMO_PATH} variant="secondary" onClick={event => { if (captureInMemory) { event.preventDefault(); setLeaveOpen(true); } }}><ArrowLeft size={17} aria-hidden="true" /> {live ? "Mis partidos" : "Casos de demostración"}</ActionLink><span className="flex items-center gap-2 text-xs font-semibold text-muted">{live ? <ClipboardPenLine size={16} aria-hidden="true" /> : <FlaskConical size={16} aria-hidden="true" />} {live ? "Cédula online" : "PDGLD-148 · Datos sintéticos"}</span></div>
    {live ? <ReportNotice>Guarda el avance de la cédula para continuar después. {confirmationUnavailable && confirmationMessage}</ReportNotice> : <div className="rounded-xl border border-accent bg-surface px-4 py-3 text-sm leading-6"><strong>Demo sintética · Solo memoria.</strong> {stage < 0 ? "La sesión es real; el partido, su designación y las respuestas son simulados. Sin persistencia ni almacenamiento offline. " : "Se pierde al salir. "}No ingreses datos ni firmas reales.</div>}
    {viewState === "denied" ? <section className="rounded-3xl border border-border bg-surface p-7 text-center"><LockKeyhole className="mx-auto mb-4 text-muted" size={32} aria-hidden="true" /><h1 className="text-2xl font-semibold text-primary">Acceso denegado</h1><p className="mx-auto mt-3 max-w-lg text-muted">La designación o el permiso para este partido no están vigentes en este caso sintético. Una sesión iniciada no autoriza por sí sola la captura.</p></section>
      : viewState === "loading" ? <section className="rounded-3xl border border-border bg-surface p-7" aria-busy="true"><h1 className="flex items-center gap-3 text-xl font-semibold"><LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> Cargando partido y cédula…</h1><p role="status" className="mt-3 text-muted">Espera simulada. No hay una consulta de datos en curso.</p><div className="my-6 h-24 rounded-xl bg-soft" aria-hidden="true" /><button type="button" className={secondaryButton} onClick={() => setViewState("ready")}>Completar carga simulada</button></section>
        : viewState === "error" ? <section className="rounded-3xl border border-danger bg-danger-surface p-7"><h1 className="text-xl font-semibold text-danger">No se pudo consultar la cédula</h1><p role="alert" className="my-4 text-danger">Error sintético. No se puede afirmar que la información esté guardada.</p><button type="button" className={secondaryButton} onClick={() => setViewState("ready")}>Reintentar consulta simulada</button></section> : <>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">{stage < 0 ? (live ? "Partido autorizado" : "Partido asignado · Demostración") : (confirmed || !match.status.captureAllowed) ? "Consultar cédula" : "Capturar cédula arbitral"}</h1>
          <MatchHeader match={match} report={report} compact={stage >= 0} />
          {stage < 0 ? <section className="rounded-2xl border border-border bg-surface p-5 sm:p-7"><div className="flex items-start gap-3"><ClipboardPenLine size={26} className="shrink-0 text-primary" aria-hidden="true" /><div><h2 className="text-lg font-semibold text-primary">Tu cédula comienza en este partido</h2><p className="mt-2 text-sm leading-6 text-muted">{live ? "El servidor verificó tu permiso y ámbito para este partido. La elegibilidad se vuelve a comprobar al guardar." : "Designación aprobada y permiso de captura: ejemplos sintéticos. El acceso funcional se integrará con los servicios autorizados del partido."}</p></div></div>{!match.status.captureAllowed ? <div className="mt-5"><ReportNotice>Partido {match.status.label.toLocaleLowerCase("es")}: {live ? "el estado actual no permite capturar la cédula." : "la captura está bloqueada en este caso. La política definitiva de estados depende de PDGLD-85."}</ReportNotice></div> : <button type="button" className={`${primaryButton} mt-5 w-full sm:w-auto`} onClick={() => move(0)}>Capturar cédula <ArrowRight size={18} aria-hidden="true" /></button>}</section> : <>
            <nav aria-label="Secciones de la cédula" className="sticky top-16 z-10 overflow-x-auto lg:top-20 rounded-2xl border border-border bg-surface p-2"><ol className="flex min-w-max gap-1">{steps.map((label, index) => <li key={label}><button type="button" aria-label={label} aria-current={stage === index ? "step" : undefined} className={`flex min-h-12 items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${stage === index ? "border-accent bg-soft text-primary" : "border-transparent text-muted hover:bg-background"}`} onClick={() => move(index)}><span className="text-xs" aria-hidden="true">{index + 1 < 10 ? `0${index + 1}` : index + 1}</span>{label}</button></li>)}</ol></nav>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><p role="status" className="flex items-center gap-2">{state === "saving" ? <LoaderCircle size={15} className="motion-safe:animate-spin" aria-hidden="true" /> : confirmed ? <LockKeyhole size={15} aria-hidden="true" /> : <span className="size-2 rounded-full bg-current" aria-hidden="true" />}{operationText}</p><p>Partido v{match.version} · Cédula v{report.version}</p></div>
            {message && <p role="status" className="rounded-xl border border-border bg-surface p-4 text-sm leading-6">{message}</p>}
            {state === "stale" && <div role="alert" className="space-y-3 rounded-2xl border border-danger bg-danger-surface p-5"><h2 className="font-semibold text-danger">Cambió la versión de referencia</h2><p className="text-sm text-danger">Tu captura v{operation?.expectedReportVersion ?? report.version} sigue intacta en memoria. No se puede guardar ni confirmar sobre una versión distinta.</p>{live ? <ActionLink variant="secondary" href={`/matches/${match.id}/report`} target="_blank" rel="noopener noreferrer">Abrir versión vigente en otra pestaña</ActionLink> : <button type="button" className={secondaryButton} onClick={() => setCompareOpen(true)}>Comparar versiones simuladas</button>}</div>}
            {state === "uncertain" && <div role="alert" className="space-y-3 rounded-2xl border border-accent bg-surface p-5"><h2 className="font-semibold text-primary">No conocemos el resultado</h2><p className="text-sm leading-6">Se conserva la operación y su versión. La edición está bloqueada. Consulta primero: un fallo de respuesta no significa que falló el guardado.</p><p className="break-all text-xs text-muted">Operación: {operation?.id} · Base v{operation?.expectedReportVersion}</p><div className="flex flex-wrap gap-2"><button type="button" className={secondaryButton} onClick={() => queryResult(true)}>{live ? "Consultar acuse en servidor" : "Simular consulta: aplicada"}</button>{live ? <button type="button" className={secondaryButton} onClick={() => operation && runOperation(operation.kind, operation)}>Reenviar misma operación</button> : <button type="button" className={secondaryButton} onClick={() => queryResult(false)}>Simular consulta: no aplicada</button>}</div></div>}
            {state === "denied" && <ReportNotice danger>Acceso denegado. No se puede continuar guardando ni confirmando. La captura pendiente permanece en esta página.</ReportNotice>}
            {state === "error" && operation && !(operation.kind === "confirm" && confirmationUnavailable) && <button type="button" className={secondaryButton} onClick={() => runOperation(operation.kind, operation)}>{live ? "Reintentar misma operación" : "Reintentar misma operación simulada"}</button>}
            <h2 ref={panelHeading} tabIndex={-1} className="sr-only scroll-mt-40">{steps[stage]}</h2>
            {stage === 0 && sealed && <><div className="flex flex-wrap gap-2" aria-label="Modo de captura"><button type="button" aria-pressed={captureMode === "live"} className={captureMode === "live" ? primaryButton : secondaryButton} onClick={() => setCaptureMode("live")}>Captura en vivo</button><button type="button" aria-pressed={captureMode === "posterior"} className={captureMode === "posterior" ? primaryButton : secondaryButton} onClick={() => setCaptureMode("posterior")}>Captura posterior</button></div>{captureMode === "live" ? <ReportClock clock={report.clock ?? null} locked={locked} dialog={clockDialog} onDialog={setClockDialog} onAction={action => runOperation("clock", undefined, undefined, action)} /> : <ReportNotice>Usa Participación y Eventos para registrar posteriormente lo ocurrido. Los minutos se indican manualmente.</ReportNotice>}</>}
            <div hidden={stage !== 0}><ReportLineups data={data} report={report} live={Boolean(live)} locked={locked || sealed} onLineup={lineup} onTactics={tactics} onPlayer={setActionPlayer} onCaptain={(teamId, playerId) => !sealed && edit(current => ({ ...current, captains: { ...current.captains, [teamId]: playerId } }))} /></div>
            <div hidden={stage !== 1}><ReportParticipation data={data} report={report} live={Boolean(live)} locked={eventLocked} onPeriod={(playerId, index) => setPeriodEditor({ playerId, index })} onRemovePeriod={(playerId, index) => lineup(playerId, { periods: report.lineups.find(row => row.playerId === playerId)!.periods.filter((_, i) => i !== index) })} onChange={() => setEventEditor({ changeOnly: true })} onEditEvent={id => setEventEditor({ id })} onRemoveEvent={removeEvent} onMoveEvent={moveEvent} /></div>
            <div hidden={stage !== 2}><section aria-label="Eventos del partido"><SectionHeading number="03" title="Lo que ocurrió en el partido">{live ? "Eventos del catálogo vigente." : "Eventos del catálogo de ejemplo."} Equipo y jugador dependen del tipo; periodo y minuto son opcionales.</SectionHeading><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">{report.events.length} eventos registrados · Orden del registro</p><button type="button" className={secondaryButton} disabled={eventLocked} onClick={() => setEventEditor({})}><Plus size={18} aria-hidden="true" /> {report.clock?.phase === "BREAK" ? "Registrar cambio" : "Registrar evento"}</button></div><ReportEvents data={data} report={report} live={Boolean(live)} locked={eventLocked || report.clock?.phase === "BREAK"} onEdit={id => setEventEditor({ id })} onRemove={removeEvent} onMove={moveEvent} /></section></div>
            <div hidden={stage !== 3}><ReportClosing data={data} report={report} live={Boolean(live)} locked={eventLocked} signatureEpoch={signatureEpoch} onScore={(side, value) => edit(current => ({ ...current, score: { ...current.score, [side]: value } }))} onRemarks={remarks => edit(current => ({ ...current, remarks }))} onIncidents={incidents => edit(current => ({ ...current, incidents }))} onSignature={signature} /></div>
            <div hidden={stage !== 4}><ReportSummary data={data} report={report} live={Boolean(live)} issues={issues} /></div>
            <footer className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><button type="button" className={secondaryButton} disabled={stage === 0} onClick={() => move(stage - 1)}><ArrowLeft size={17} aria-hidden="true" /> Anterior</button><div className="flex flex-wrap gap-2">{!confirmed && <button type="button" className={secondaryButton} disabled={locked || invalidJerseys} onClick={() => runOperation("save")}><Save size={17} aria-hidden="true" /> {live ? "Guardar borrador" : "Guardar · Simulación"}</button>}{stage < 4 ? <button type="button" className={primaryButton} disabled={stage === 0 && (locked || invalidJerseys)} onClick={() => { if (stage === 0 && sealed && captureMode === "live" && report.clock?.phase !== "ENDED") setClockDialog(!report.clock ? "start" : report.clock.phase === "BREAK" ? "start-second" : "end-half"); else move(stage === 0 && report.clock?.phase === "ENDED" ? 3 : stage + 1); }}>{stage === 0 && sealed && captureMode === "live" ? !report.clock ? "Iniciar partido" : report.clock.phase === "BREAK" ? "Iniciar segundo tiempo" : report.clock.phase === "ENDED" ? "Ir al cierre" : "Terminar tiempo" : stage === 3 ? "Revisar resumen" : "Continuar"}<ArrowRight size={17} aria-hidden="true" /></button> : !confirmed ? <button type="button" className={primaryButton} disabled={confirmationUnavailable || locked || issues.length > 0} aria-describedby={confirmationUnavailable ? "report-confirmation-availability" : undefined} onClick={() => { setAccepted(false); setConfirmOpen(true); }}><ClipboardCheck size={18} aria-hidden="true" /> {live ? "Solicitar confirmación" : "Confirmar · Simulación"}</button> : <span className="flex items-center gap-2 text-sm font-semibold text-positive"><Check size={18} aria-hidden="true" /> Consulta sin edición</span>}</div></div>{confirmationUnavailable && !confirmed && <p id="report-confirmation-availability" role="status" className="text-sm leading-6 text-muted">{confirmationMessage}</p>}<p className="text-xs leading-5 text-muted">{live ? "Solo un acuse confirma el guardado. La captura pendiente y sus firmas se conservan en esta página; no hay almacenamiento offline." : "La captura, incluidas las firmas, se pierde al salir de esta página. Guardar y confirmar solo simulan una respuesta."}</p></footer>
            {!confirmed && !live && <details className="rounded-2xl border border-dashed border-border bg-background p-4"><summary className="cursor-pointer py-2 text-sm font-semibold text-muted">Controles de demostración</summary><div className="mt-3 max-w-md"><label className="mb-2 block text-sm font-medium" htmlFor="demo-response">Respuesta del próximo guardado o confirmación</label><SelectField id="demo-response" value={response} onValueChange={value => setResponse(value as ResponseMode)} disabled={state === "saving"} options={responseOptions} searchable={false} /><p className="mt-3 text-xs leading-5 text-muted">Estos controles permiten revisar errores sin backend. No cambian permisos ni versiones reales.</p></div></details>}
          </>}
        </>}
    {periodEditor && <PeriodDialog data={data} report={report} editing={periodEditor} onClose={() => setPeriodEditor(null)} onSave={(playerId, index, period) => { const rows = [...report.lineups.find(row => row.playerId === playerId)!.periods]; if (index === null) rows.push(period); else rows[index] = period; lineup(playerId, { periods: rows }); setPeriodEditor(null); }} />}
    {actionPlayer && data.players.some(p => p.id === actionPlayer) && <PlayerActionsDialog player={data.players.find(p => p.id === actionPlayer)!} data={data} report={report} tactics={teamTactics(data, report, data.players.find(p => p.id === actionPlayer)!.teamId)} breakOnly={report.clock?.phase === "BREAK"} locked={eventLocked || (captureMode === "live" && (!report.clock || report.clock.phase === "ENDED"))} onClose={() => setActionPlayer(null)} onAction={code => { const player = data.players.find(p => p.id === actionPlayer)!; const timing = captureMode === "live" && report.clock ? clockReading(report.clock, Date.now()) : null; setActionPlayer(null); setEventEditor({ changeOnly: code === "SUBSTITUTION", initial: { typeCode: code, teamId: player.teamId, ...(timing ? { minute: timing.minute, second: timing.second, periodNumber: timing.periodNumber, periodMinute: timing.periodMinute } : {}), ...(code === "SUBSTITUTION" && currentPitch(teamTactics(data, report, player.teamId).slots, report.events, player.teamId).slots.some(s => s.playerId === player.id) ? { outgoingPlayerId: player.id } : { playerId: player.id }) } }); }} />}
    {eventEditor && <EventDialog data={data} report={report} live={Boolean(live)} liveCapture={stage === 0 && captureMode === "live" || report.clock?.phase === "BREAK"} event={report.events.find(event => event.id === eventEditor.id)} initial={eventEditor.initial} changeOnly={eventEditor.changeOnly} onClose={() => setEventEditor(null)} onSave={saveEvent} />}
    <FormDialog open={lineupConfirm} title="Guardar once inicial" description="Revisa la convocatoria, posiciones, dorsales, capitanes y uniformes de ambos equipos." pending={state === "saving"} onClose={() => setLineupConfirm(false)} footer={<button type="button" className={primaryButton} disabled={!lineupAccepted || sealIssues.length > 0 || locked} onClick={() => runOperation("lock-lineups")}>Confirmar y guardar alineaciones</button>}>
      <p className="text-sm leading-6">Después del acuse no podrás editar el once inicial, la convocatoria, los dorsales, capitanes ni uniformes. Los cambios durante el partido se registrarán como eventos.</p>
      <ul className="my-4 space-y-2 text-sm">{[match.home, match.away].map(team => { const count = teamTactics(data, report, team.id).slots.filter(slot => slot.playerId).length; return <li key={team.id}>{team.name}: {count} titulares · {11 - count} posiciones sin asignar.</li>; })}</ul>
      {sealIssues.length > 0 && <ul role="alert" className="space-y-2 text-sm text-danger">{sealIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      <label className="mt-4 flex min-h-12 items-start gap-3"><input type="checkbox" className="mt-1 size-5 accent-[var(--action)]" checked={lineupAccepted} disabled={locked} onChange={event => setLineupAccepted(event.target.checked)} /><span className="text-sm leading-6">Revisé ambos equipos, incluidas las posiciones sin asignar. Confirmo guardar y bloquear estas alineaciones.</span></label>
    </FormDialog>
    <FormDialog open={confirmOpen && !confirmationUnavailable} title={live ? "Confirmar cédula" : "Confirmar cédula · Simulación"} description="Revisa el resumen completo antes de dar esta confirmación explícita." pending={state === "saving"} onClose={() => setConfirmOpen(false)} footer={<button type="button" className={primaryButton} disabled={confirmationUnavailable || !accepted || state === "saving" || issues.length > 0} onClick={() => runOperation("confirm")}>{state === "saving" ? (live ? "Esperando acuse…" : "Esperando respuesta simulada…") : (live ? "Confirmar cédula" : "Sí, confirmar cédula de ejemplo")}</button>}>
      <p className="text-sm leading-6">{match.home.name} {report.score.home} : {report.score.away} {match.away.name}. La cédula pasará a consulta y quedará bloqueada para edición normal {!live && "dentro de esta demo"}.</p><p className="mt-3 text-sm text-muted">{live ? "La confirmación requiere un acuse del servidor para generar el cierre oficial." : "No se generarán resultado oficial, clasificación, expediente ni almacenamiento de firmas."}</p><label className="mt-5 flex min-h-12 items-start gap-3 rounded-xl border border-border p-4"><input type="checkbox" checked={accepted} disabled={state === "saving"} onChange={event => setAccepted(event.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--action)]" /><span className="text-sm leading-6">He revisado alineaciones, tiempos, cambios, eventos, marcador y firmas. {live ? "Quiero confirmar esta cédula." : "Quiero confirmar esta cédula de ejemplo."}</span></label>
    </FormDialog>
    <FormDialog open={compareOpen} title="Comparar versiones" description="Ejemplo de conflicto de cédula. No se sobrescribe la captura." onClose={() => setCompareOpen(false)} footer={<button type="button" className={secondaryButton} onClick={() => { setCompareOpen(false); setMessage("Se cerró la comparación. La versión base sigue obsoleta; no se habilitará el guardado hasta reiniciar explícitamente el ejemplo."); }}>Conservar mi captura</button>}>
      <div className="grid gap-4 sm:grid-cols-2"><article className="rounded-xl border border-border p-4"><h3 className="font-semibold">Tu captura · v{report.version}</h3><p className="mt-2 text-sm">Marcador: {report.score.home ?? "–"} : {report.score.away ?? "–"}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{report.remarks || "Sin observaciones"}</p></article><article className="rounded-xl border border-accent p-4"><h3 className="font-semibold">Referencia simulada · v{report.version + 1}</h3><p className="mt-2 text-sm">Marcador: {savedReport.score.home ?? "–"} : {savedReport.score.away ?? "–"}</p><p className="mt-2 text-sm text-muted">Observación de otra captura de ejemplo. No se ha conciliado con tu versión.</p></article></div><p className="mt-4 text-sm text-muted">La conciliación real queda pendiente del contrato de backend. Para volver a probar, sal a los casos y abre de nuevo el ejemplo; perderás la captura actual.</p>
    </FormDialog>
    <FormDialog open={leaveOpen} title={live ? "Salir de la captura" : "Salir de la demostración"} description="La captura solo existe en memoria de esta página." onClose={() => setLeaveOpen(false)} footer={<ActionLink href={live ? "/matches" : REPORT_DEMO_PATH} onClick={() => { setLeaveOpen(false); }}>Salir y perder esta captura</ActionLink>}><p className="text-sm leading-6">{live ? "Al salir perderás los cambios pendientes y cualquier operación sin acuse conservada en esta página. Lo guardado con acuse permanece en el servidor." : "Al salir perderás los datos y firmas capturados, incluso si viste un guardado simulado."} {state === "uncertain" ? (live ? "El resultado del guardado sigue incierto; salir no lo convierte en un fallo ni cancela la operación." : "El resultado simulado sigue incierto; salir no lo convierte en un fallo ni cancela la operación.") : "Puedes cancelar para seguir revisando."}</p></FormDialog>
  </div>;
}
