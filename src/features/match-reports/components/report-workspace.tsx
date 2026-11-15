"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ClipboardCheck, ClipboardPenLine, FlaskConical, LoaderCircle, LockKeyhole, Plus, Save } from "lucide-react";
import { ActionLink } from "@/components/ui/action-link";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
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

type OperationState = "idle" | "dirty" | "saving" | "saved" | "error" | "stale" | "uncertain" | "denied";
type ResponseMode = "success" | "error" | "stale" | "uncertain" | "denied";
type DemoOperation = {
  id: string; kind: "save" | "confirm"; expectedReportVersion: number; expectedMatchVersion: number;
  snapshot: MatchReportPresentation;
};
const steps = ["Alineaciones", "Participación", "Eventos", "Cierre y firmas", "Resumen"];
const responseOptions = [
  { value: "success", label: "Respuesta correcta" }, { value: "error", label: "Error conocido · Sin cambios" },
  { value: "stale", label: "Versión obsoleta" }, { value: "uncertain", label: "Resultado incierto" },
  { value: "denied", label: "Pérdida de permiso" },
];

export function ReportWorkspace({ data }: { data: ReportDemoData }) {
  const [match, setMatch] = useState(data.match);
  const [report, setReport] = useState(data.report);
  const [savedReport, setSavedReport] = useState(data.report);
  const [stage, setStage] = useState(data.scenario === "confirmed" || data.scenario === "stale" || data.scenario === "uncertain" ? 4 : -1);
  const [viewState, setViewState] = useState(["denied", "loading", "error"].includes(data.scenario) ? data.scenario : "ready");
  const [state, setState] = useState<OperationState>(data.scenario === "stale" ? "stale" : data.scenario === "uncertain" ? "uncertain" : "idle");
  const [response, setResponse] = useState<ResponseMode>("success");
  const [operation, setOperation] = useState<DemoOperation | null>(data.scenario === "uncertain" || data.scenario === "stale" ? {
    id: "demo-operation-018", kind: "save", expectedReportVersion: data.report.version, expectedMatchVersion: data.match.version, snapshot: data.report,
  } : null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [signatureEpoch, setSignatureEpoch] = useState(0);
  const [message, setMessage] = useState("");
  const [periodEditor, setPeriodEditor] = useState<{ playerId: string; index: number | null } | null>(null);
  const [eventEditor, setEventEditor] = useState<{ id?: string; changeOnly?: boolean } | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const confirmed = report.status === "CONFIRMED";
  const locked = confirmed || !match.status.captureAllowed || ["saving", "stale", "uncertain", "denied"].includes(state);
  const issues = reviewReportPresentation(data, report);
  const captureInMemory = stage >= 0 && !confirmed;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!captureInMemory) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [captureInMemory]);

  function move(next: number) {
    setStage(next);
    requestAnimationFrame(() => { panelHeading.current?.focus(); panelHeading.current?.scrollIntoView({ block: "start" }); });
  }
  function edit(update: (current: MatchReportPresentation) => MatchReportPresentation) {
    if (locked || busy.current) return;
    const hadSignatures = Object.values(report.signatures).some(Boolean);
    setReport(current => ({ ...update(current), signatures: { home: null, away: null } }));
    if (hadSignatures) { setSignatureEpoch(value => value + 1); setMessage("Cambió la captura. Se retiraron ambas firmas; vuelve a solicitarlas antes de confirmar."); }
    else setMessage("Cambios solo en memoria. Se perderán al recargar o salir.");
    setState("dirty"); setOperation(null);
  }
  function lineup(playerId: string, changes: Partial<ReportLineup>) {
    edit(current => {
      const captains = { ...current.captains };
      if (changes.selected === false) for (const team of [match.home, match.away]) if (captains[team.id] === playerId) delete captains[team.id];
      return { ...current, captains, lineups: current.lineups.map(row => row.playerId === playerId ? { ...row, ...changes } : row) };
    });
  }
  function signature(teamId: string, value: CaptainSignature | null) {
    if (locked || busy.current) return;
    setReport(current => ({ ...current, signatures: { ...current.signatures, [teamId]: value } }));
    setState("dirty"); setOperation(null);
    setMessage(value ? "Firma confirmada en memoria. No se envió ni se guardó en el dispositivo." : "Firma pendiente.");
  }
  function finishSuccess(op: DemoOperation) {
    const next: MatchReportPresentation = { ...structuredClone(op.snapshot), version: op.expectedReportVersion + 1,
      status: op.kind === "confirm" ? "CONFIRMED" : "DRAFT", confirmedAt: op.kind === "confirm" ? new Date().toISOString() : null };
    setReport(next); setSavedReport(next); setState("saved"); setOperation(null);
    if (op.kind === "confirm") { setMatch(current => ({ ...current, status: { code: "FINISHED", label: "Finalizado", captureAllowed: false } })); move(4); }
    setMessage(op.kind === "confirm" ? "Confirmación simulada recibida. Edición normal deshabilitada; no hay resultado oficial." : "Guardado simulado recibido. La copia solo vive en memoria y se pierde al salir o recargar.");
  }
  function runOperation(kind: "save" | "confirm", retry?: DemoOperation) {
    if (busy.current || locked || (kind === "confirm" && issues.length > 0)) return;
    busy.current = true;
    const next = retry ?? { id: crypto.randomUUID(), kind, expectedReportVersion: report.version, expectedMatchVersion: match.version, snapshot: structuredClone(report) };
    setOperation(next); setState("saving"); setMessage("Esperando respuesta simulada. No se envía ninguna solicitud.");
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
    if (applied) finishSuccess(operation);
    else { setState("error"); setMessage("Consulta simulada: la operación no se aplicó. Se conserva su contenido y versión para un reintento manual."); }
  }
  const operationText = state === "saving" ? "Esperando respuesta simulada…" : state === "saved" ? "Guardado simulado · Solo memoria" : state === "dirty" ? "Cambios sin guardar · Solo memoria" : state === "error" ? "Error simulado · Sin aplicar" : state === "stale" ? "Versión obsoleta · Captura conservada" : state === "uncertain" ? "Resultado incierto · Sin reenviar" : state === "denied" ? "Permiso perdido · Edición bloqueada" : confirmed ? "Solo consulta · Ejemplo" : "Borrador de ejemplo";

  return <div className="space-y-5" data-report-workspace="">
    <div className="flex flex-wrap items-center justify-between gap-3"><ActionLink href={REPORT_DEMO_PATH} variant="secondary" onClick={event => { if (captureInMemory) { event.preventDefault(); setLeaveOpen(true); } }}><ArrowLeft size={17} aria-hidden="true" /> Casos de demostración</ActionLink><span className="flex items-center gap-2 text-xs font-semibold text-muted"><FlaskConical size={16} aria-hidden="true" /> PDGLD-148 · Datos sintéticos</span></div>
    <div className="rounded-xl border border-accent bg-surface px-4 py-3 text-sm leading-6"><strong>Demo sintética · Solo memoria.</strong> {stage < 0 ? "La sesión es real; el partido, su designación y las respuestas son simulados. Sin persistencia ni almacenamiento offline. " : "Se pierde al salir. "}No ingreses datos ni firmas reales.</div>
    {viewState === "denied" ? <section className="rounded-3xl border border-border bg-surface p-7 text-center"><LockKeyhole className="mx-auto mb-4 text-muted" size={32} aria-hidden="true" /><h1 className="text-2xl font-semibold text-primary">Acceso denegado</h1><p className="mx-auto mt-3 max-w-lg text-muted">La designación o el permiso para este partido no están vigentes en este caso sintético. Una sesión iniciada no autoriza por sí sola la captura.</p></section>
      : viewState === "loading" ? <section className="rounded-3xl border border-border bg-surface p-7" aria-busy="true"><h1 className="flex items-center gap-3 text-xl font-semibold"><LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> Cargando partido y cédula…</h1><p role="status" className="mt-3 text-muted">Espera simulada. No hay una consulta de datos en curso.</p><div className="my-6 h-24 rounded-xl bg-soft" aria-hidden="true" /><button type="button" className={secondaryButton} onClick={() => setViewState("ready")}>Completar carga simulada</button></section>
        : viewState === "error" ? <section className="rounded-3xl border border-danger bg-danger-surface p-7"><h1 className="text-xl font-semibold text-danger">No se pudo consultar la cédula</h1><p role="alert" className="my-4 text-danger">Error sintético. No se puede afirmar que la información esté guardada.</p><button type="button" className={secondaryButton} onClick={() => setViewState("ready")}>Reintentar consulta simulada</button></section> : <>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">{stage < 0 ? "Partido asignado · Demostración" : confirmed ? "Consultar cédula" : "Capturar cédula arbitral"}</h1>
          <MatchHeader match={match} report={report} compact={stage >= 0} />
          {stage < 0 ? <section className="rounded-2xl border border-border bg-surface p-5 sm:p-7"><div className="flex items-start gap-3"><ClipboardPenLine size={26} className="shrink-0 text-primary" aria-hidden="true" /><div><h2 className="text-lg font-semibold text-primary">Tu cédula comienza en este partido</h2><p className="mt-2 text-sm leading-6 text-muted">Designación aprobada y permiso de captura: ejemplos sintéticos. El acceso funcional se integrará con los servicios autorizados del partido.</p></div></div>{!match.status.captureAllowed ? <div className="mt-5"><ReportNotice>Partido {match.status.label.toLocaleLowerCase("es")}: la captura está bloqueada en este caso. La política definitiva de estados depende de PDGLD-85.</ReportNotice></div> : <button type="button" className={`${primaryButton} mt-5 w-full sm:w-auto`} onClick={() => move(0)}>Capturar cédula <ArrowRight size={18} aria-hidden="true" /></button>}</section> : <>
            <nav aria-label="Secciones de la cédula" className="sticky top-16 z-10 overflow-x-auto lg:top-20 rounded-2xl border border-border bg-surface p-2"><ol className="flex min-w-max gap-1">{steps.map((label, index) => <li key={label}><button type="button" aria-label={label} aria-current={stage === index ? "step" : undefined} className={`flex min-h-12 items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${stage === index ? "border-accent bg-soft text-primary" : "border-transparent text-muted hover:bg-background"}`} onClick={() => move(index)}><span className="text-xs" aria-hidden="true">{index + 1 < 10 ? `0${index + 1}` : index + 1}</span>{label}</button></li>)}</ol></nav>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><p role="status" className="flex items-center gap-2">{state === "saving" ? <LoaderCircle size={15} className="motion-safe:animate-spin" aria-hidden="true" /> : confirmed ? <LockKeyhole size={15} aria-hidden="true" /> : <span className="size-2 rounded-full bg-current" aria-hidden="true" />}{operationText}</p><p>Partido v{match.version} · Cédula v{report.version}</p></div>
            {message && <p role="status" className="rounded-xl border border-border bg-surface p-4 text-sm leading-6">{message}</p>}
            {state === "stale" && <div role="alert" className="space-y-3 rounded-2xl border border-danger bg-danger-surface p-5"><h2 className="font-semibold text-danger">Cambió la versión de referencia</h2><p className="text-sm text-danger">Tu captura v{operation?.expectedReportVersion ?? report.version} sigue intacta en memoria. No se puede guardar ni confirmar sobre una versión distinta.</p><button type="button" className={secondaryButton} onClick={() => setCompareOpen(true)}>Comparar versiones simuladas</button></div>}
            {state === "uncertain" && <div role="alert" className="space-y-3 rounded-2xl border border-accent bg-surface p-5"><h2 className="font-semibold text-primary">No conocemos el resultado</h2><p className="text-sm leading-6">Se conserva la operación y su versión. La edición y el reenvío están bloqueados. Consulta primero: un fallo de respuesta no significa que falló el guardado.</p><p className="break-all text-xs text-muted">Operación de demo: {operation?.id} · Base v{operation?.expectedReportVersion}</p><div className="flex flex-wrap gap-2"><button type="button" className={secondaryButton} onClick={() => queryResult(true)}>Simular consulta: aplicada</button><button type="button" className={secondaryButton} onClick={() => queryResult(false)}>Simular consulta: no aplicada</button></div></div>}
            {state === "denied" && <ReportNotice danger>Acceso denegado en la respuesta simulada. No se puede continuar guardando ni confirmando. La captura permanece visible en memoria para esta revisión; no se concede ningún permiso real.</ReportNotice>}
            {state === "error" && operation && <button type="button" className={secondaryButton} onClick={() => runOperation(operation.kind, operation)}>Reintentar misma operación simulada</button>}
            <h2 ref={panelHeading} tabIndex={-1} className="sr-only scroll-mt-40">{steps[stage]}</h2>
            <div hidden={stage !== 0}><ReportLineups data={data} report={report} locked={locked} onLineup={lineup} onCaptain={(teamId, playerId) => edit(current => ({ ...current, captains: { ...current.captains, [teamId]: playerId } }))} /></div>
            <div hidden={stage !== 1}><ReportParticipation data={data} report={report} locked={locked} onPeriod={(playerId, index) => setPeriodEditor({ playerId, index })} onRemovePeriod={(playerId, index) => lineup(playerId, { periods: report.lineups.find(row => row.playerId === playerId)!.periods.filter((_, i) => i !== index) })} onChange={() => setEventEditor({ changeOnly: true })} onEditEvent={id => setEventEditor({ id })} onRemoveEvent={id => edit(current => ({ ...current, events: current.events.filter(event => event.id !== id) }))} /></div>
            <div hidden={stage !== 2}><section aria-label="Eventos del partido"><SectionHeading number="03" title="Lo que ocurrió en el partido">Eventos del catálogo de ejemplo. Equipo y jugador dependen del tipo; periodo y minuto son opcionales.</SectionHeading><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">{report.events.length} eventos registrados · Orden de captura</p><button type="button" className={secondaryButton} disabled={locked} onClick={() => setEventEditor({})}><Plus size={18} aria-hidden="true" /> Registrar evento</button></div><ReportEvents data={data} report={report} locked={locked} onEdit={id => setEventEditor({ id })} onRemove={id => edit(current => ({ ...current, events: current.events.filter(event => event.id !== id) }))} /></section></div>
            <div hidden={stage !== 3}><ReportClosing data={data} report={report} locked={locked} signatureEpoch={signatureEpoch} onScore={(side, value) => edit(current => ({ ...current, score: { ...current.score, [side]: value } }))} onRemarks={remarks => edit(current => ({ ...current, remarks }))} onIncidents={incidents => edit(current => ({ ...current, incidents }))} onSignature={signature} /></div>
            <div hidden={stage !== 4}><ReportSummary data={data} report={report} issues={issues} /></div>
            <footer className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><button type="button" className={secondaryButton} disabled={stage === 0} onClick={() => move(stage - 1)}><ArrowLeft size={17} aria-hidden="true" /> Anterior</button><div className="flex flex-wrap gap-2">{!confirmed && <button type="button" className={secondaryButton} disabled={locked} onClick={() => runOperation("save")}><Save size={17} aria-hidden="true" /> Guardar · Simulación</button>}{stage < 4 ? <button type="button" className={primaryButton} onClick={() => move(stage + 1)}>{stage === 3 ? "Revisar resumen" : "Continuar"}<ArrowRight size={17} aria-hidden="true" /></button> : !confirmed ? <button type="button" className={primaryButton} disabled={locked || issues.length > 0} onClick={() => { setAccepted(false); setConfirmOpen(true); }}><ClipboardCheck size={18} aria-hidden="true" /> Confirmar · Simulación</button> : <span className="flex items-center gap-2 text-sm font-semibold text-positive"><Check size={18} aria-hidden="true" /> Consulta sin edición</span>}</div></div><p className="text-xs leading-5 text-muted">La captura, incluidas las firmas, se pierde al salir de esta página. Guardar y confirmar solo simulan una respuesta.</p></footer>
            {!confirmed && <details className="rounded-2xl border border-dashed border-border bg-background p-4"><summary className="cursor-pointer py-2 text-sm font-semibold text-muted">Controles de demostración</summary><div className="mt-3 max-w-md"><label className="mb-2 block text-sm font-medium" htmlFor="demo-response">Respuesta del próximo guardado o confirmación</label><SelectField id="demo-response" value={response} onValueChange={value => setResponse(value as ResponseMode)} disabled={state === "saving"} options={responseOptions} searchable={false} /><p className="mt-3 text-xs leading-5 text-muted">Estos controles permiten revisar errores sin backend. No cambian permisos ni versiones reales.</p></div></details>}
          </>}
        </>}
    {periodEditor && <PeriodDialog data={data} report={report} editing={periodEditor} onClose={() => setPeriodEditor(null)} onSave={(playerId, index, period) => { const rows = [...report.lineups.find(row => row.playerId === playerId)!.periods]; if (index === null) rows.push(period); else rows[index] = period; lineup(playerId, { periods: rows }); setPeriodEditor(null); }} />}
    {eventEditor && <EventDialog data={data} report={report} event={report.events.find(event => event.id === eventEditor.id)} changeOnly={eventEditor.changeOnly} onClose={() => setEventEditor(null)} onSave={event => { edit(current => ({ ...current, events: current.events.some(item => item.id === event.id) ? current.events.map(item => item.id === event.id ? event : item) : [...current.events, event] })); setEventEditor(null); }} />}
    <FormDialog open={confirmOpen} title="Confirmar cédula · Simulación" description="Revisa el resumen completo antes de dar esta confirmación explícita." pending={state === "saving"} onClose={() => setConfirmOpen(false)} footer={<button type="button" className={primaryButton} disabled={!accepted || state === "saving" || issues.length > 0} onClick={() => runOperation("confirm")}>{state === "saving" ? "Esperando respuesta simulada…" : "Sí, confirmar cédula de ejemplo"}</button>}>
      <p className="text-sm leading-6">{match.home.name} {report.score.home} : {report.score.away} {match.away.name}. La cédula pasará a consulta y quedará bloqueada para edición normal dentro de esta demo.</p><p className="mt-3 text-sm text-muted">No se generarán resultado oficial, clasificación, expediente ni almacenamiento de firmas.</p><label className="mt-5 flex min-h-12 items-start gap-3 rounded-xl border border-border p-4"><input type="checkbox" checked={accepted} disabled={state === "saving"} onChange={event => setAccepted(event.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--action)]" /><span className="text-sm leading-6">He revisado alineaciones, tiempos, cambios, eventos, marcador y firmas. Quiero confirmar esta cédula de ejemplo.</span></label>
    </FormDialog>
    <FormDialog open={compareOpen} title="Comparar versiones" description="Ejemplo de conflicto de cédula. No se sobrescribe la captura." onClose={() => setCompareOpen(false)} footer={<button type="button" className={secondaryButton} onClick={() => { setCompareOpen(false); setMessage("Se cerró la comparación. La versión base sigue obsoleta; no se habilitará el guardado hasta reiniciar explícitamente el ejemplo."); }}>Conservar mi captura</button>}>
      <div className="grid gap-4 sm:grid-cols-2"><article className="rounded-xl border border-border p-4"><h3 className="font-semibold">Tu captura · v{report.version}</h3><p className="mt-2 text-sm">Marcador: {report.score.home ?? "–"} : {report.score.away ?? "–"}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{report.remarks || "Sin observaciones"}</p></article><article className="rounded-xl border border-accent p-4"><h3 className="font-semibold">Referencia simulada · v{report.version + 1}</h3><p className="mt-2 text-sm">Marcador: {savedReport.score.home ?? "–"} : {savedReport.score.away ?? "–"}</p><p className="mt-2 text-sm text-muted">Observación de otra captura de ejemplo. No se ha conciliado con tu versión.</p></article></div><p className="mt-4 text-sm text-muted">La conciliación real queda pendiente del contrato de backend. Para volver a probar, sal a los casos y abre de nuevo el ejemplo; perderás la captura actual.</p>
    </FormDialog>
    <FormDialog open={leaveOpen} title="Salir de la demostración" description="La captura solo existe en memoria de esta página." onClose={() => setLeaveOpen(false)} footer={<ActionLink href={REPORT_DEMO_PATH} onClick={() => { setLeaveOpen(false); }}>Salir y perder esta captura</ActionLink>}><p className="text-sm leading-6">Al salir perderás los datos y firmas capturados, incluso si viste un guardado simulado. {state === "uncertain" ? "El resultado simulado sigue incierto; salir no lo convierte en un fallo ni cancela la operación." : "Puedes cancelar para seguir revisando."}</p></FormDialog>
  </div>;
}
