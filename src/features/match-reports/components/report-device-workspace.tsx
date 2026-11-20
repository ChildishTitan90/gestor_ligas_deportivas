"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { FormDialog } from "@/components/ui/form-dialog";
import { ReportClientError, type ReportOperation } from "../report-client";
import type { MatchReportPresentation, ReportDemoData } from "../types";
import { reportErrorMessage } from "../feedback";
import { jerseyErrors } from "../lineup-rules";
import { readLocalReport, updateLocalReport, writeLocalReport, subscribeReports, type LocalReport } from "../offline/store.client";
import { downloadOwnReport, prepareLocalReport } from "../offline/prepare.client";
import { offlineSupport } from "../offline/resources.client";
import { enqueueReport, synchronizeReport } from "../offline/sync.client";
import { resolveReportConflict, type ResolutionChoice } from "../offline/resolve.client";
import { ReportWorkspace } from "./report-workspace";
import { primaryButton, secondaryButton } from "./report-shared";

export type ReportDeviceControls = {
  report: MatchReportPresentation; match: ReportDemoData["match"];
  confirmation: ReportDemoData["confirmation"];
  setReport: Dispatch<SetStateAction<MatchReportPresentation>>;
  run(kind: ReportOperation["kind"], action?: ReportOperation["clockAction"]): void;
  locked: boolean; notice: ReactNode; safelyStored: boolean;
};

export function ReportDeviceWorkspace({ actorId, initialData, restored, onlineRequested }: { actorId: string; initialData?: ReportDemoData; restored?: LocalReport; onlineRequested?: boolean }) {
  const [record, setRecord] = useState<LocalReport | null>(restored ?? null);
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (restored) return;
    let alive = true;
    void Promise.resolve().then(async () => {
      if (!offlineSupport()) { if (alive) setOnlineOnly(true); return undefined; }
      return readLocalReport(actorId, initialData!.match.id);
    }).then(value => {
      if (!alive) return;
      if (value?.prepared) setRecord(value);
      else if (onlineRequested) setOnlineOnly(true);
      else setConsent(true);
    }).catch(() => { if (alive) setProblem("No se pudo abrir el almacenamiento. Libera espacio o habilita el almacenamiento del navegador y vuelve a preparar el partido."); });
    return () => { alive = false; };
  }, [actorId, initialData, restored, onlineRequested]);

  async function begin() {
    setStarting(true); setProblem("");
    try {
      const next = await prepareLocalReport(actorId, initialData!.match.id);
      setRecord(next); setConsent(false);
    } catch { setProblem("No se pudo habilitar el borrador local. Comprueba sesión, designación y espacio antes de reintentar."); }
    finally { setStarting(false); }
  }
  if (record) return <DeviceCapture key={record.draftId} initial={record} serverReference={initialData} />;
  if (initialData && !initialData.match.status.captureAllowed) return <ReportWorkspace data={initialData} live={{ actorId }} />;
  if (initialData && onlineOnly) return <>
    <p role="status" className="mx-auto mb-4 max-w-6xl rounded-xl border border-border bg-surface p-4 text-sm">Solo con conexión. Pulsa Guardar y espera el acuse del servidor antes de salir. Los cambios pendientes quedan en esta pestaña.</p>
    <ReportWorkspace data={initialData} live={{ actorId }} />
  </>;
  return <section className="mx-auto max-w-3xl space-y-4 rounded-2xl border border-border bg-surface p-5">
    <h1 className="text-2xl font-semibold text-primary">Prepara el partido antes de capturar</h1>
    <p className="text-sm leading-6">El borrador se guardará desde la primera edición, incluidas las firmas. La autorización local dura siete días. Al cerrar sesión explícitamente se eliminarán las copias locales, con advertencia si hay pendientes. Una sesión vencida permite retomar tras identificarte con la misma cuenta.</p>
    <p className="text-sm leading-6 text-muted">Usa un dispositivo personal con bloqueo de pantalla. La copia contiene nombres, elegibilidad y captura del partido. El almacenamiento del navegador puede eliminarse por falta de espacio.</p>
    {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
    <div className="flex flex-wrap gap-2"><button className={primaryButton} type="button" disabled={(!consent && !problem) || starting} onClick={() => void begin()}>{starting ? "Preparando partido y recursos…" : consent || problem ? "Aceptar y preparar" : "Consultando copia local…"}</button>
      {initialData && problem && <button className={secondaryButton} type="button" disabled={starting} onClick={() => setOnlineOnly(true)}>Capturar con conexión</button>}
    </div>
  </section>;
}

function DeviceCapture({ initial, serverReference }: { initial: LocalReport; serverReference?: ReportDemoData }) {
  const [record, render] = useState(initial);
  const current = useRef(initial);
  const durableRevision = useRef(initial.revision);
  const [savedRevision, setSavedRevision] = useState(initial.revision);
  const [expired, setExpired] = useState(false);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [localOperation, setLocalOperation] = useState(false);
  const [error, setError] = useState(serverReference && (serverReference.match.version !== initial.data.match.version || serverReference.report.version !== initial.data.report.version || !serverReference.match.status.captureAllowed) ? "SERVER_REFERENCE_CHANGED" : "");
  const [accountLocked, setAccountLocked] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [connected, setConnected] = useState(true);
  const [otherTab, setOtherTab] = useState<LocalReport | null>(null);
  const [comparison, setComparison] = useState<ReportDemoData | null>(serverReference ?? null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [reviewAccepted, setReviewAccepted] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolutionMessage, setResolutionMessage] = useState("");
  const comparisonRecord = useRef<LocalReport | null>(null);
  const resolutionBusy = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const syncBusy = useRef(false);
  const syncAgain = useRef(false);
  const queuedLiveClocks = useRef(new Set<string>());
  const operationBusy = useRef(false);
  const mounted = useRef(true);
  const { actorId, matchId } = initial;
  const apply = useCallback((incoming: LocalReport) => {
    const local = current.current;
    if (incoming.draftId !== local.draftId) return;
    const next = { ...incoming, revision: local.revision, editId: local.editId, data: {
      ...local.data, confirmation: incoming.data.confirmation, match: { ...local.data.match, version: incoming.data.match.version },
      report: { ...local.data.report, id: incoming.data.report.id, version: incoming.data.report.version,
        lineupsLock: incoming.data.report.lineupsLock, clock: incoming.data.report.clock },
    } };
    current.current = next;
    if (mounted.current) render(next);
  }, []);
  function save(report: MatchReportPresentation) {
    const previous = current.current;
    const next = { ...previous, editId: crypto.randomUUID(), revision: previous.revision + 1, updatedAt: new Date().toISOString(), data: { ...previous.data, report } };
    current.current = next; render(next); setSaving(true);
    // Enqueue immediately from the editing handler, never waiting for offline/unload.
    writes.current = writes.current.then(async () => {
      await writeLocalReport(next, durableRevision.current);
      durableRevision.current = next.revision;
      if (mounted.current) setSavedRevision(next.revision);
      if (current.current.revision === next.revision && mounted.current) { setSaving(false); setError(""); }
    });
    void writes.current.catch(() => { if (mounted.current) { setSaving(false); setError("LOCAL_WRITE_FAILED"); } });
  }
  const setReport: Dispatch<SetStateAction<MatchReportPresentation>> = update => {
    const next = typeof update === "function" ? update(current.current.data.report) : update;
    save(next);
  };
  async function sync(enqueue = true, manual = false) {
    if (syncBusy.current) { if (queuedLiveClocks.current.size) syncAgain.current = true; return; }
    if (!navigator.onLine) return;
    syncBusy.current = true; setSyncing(true);
    const requestedRevision = current.current.revision;
    try {
      await writes.current;
      let local = await readLocalReport(actorId, matchId);
      if (!local) throw Error("LOCAL_ACCOUNT_LOCKED");
      for (const id of queuedLiveClocks.current) if (!local.pending.some(item => item.operation.id === id)) queuedLiveClocks.current.delete(id);
      if (local.draftId !== current.current.draftId || local.editId !== current.current.editId) {
        queuedLiveClocks.current.clear(); setOtherTab(local); return;
      }
      if (local.reviewRequired) {
        if (!manual) { queuedLiveClocks.current.clear(); return; }
        local = await updateLocalReport(actorId, matchId, value => ({ ...value, reviewRequired: false }));
        apply(local);
      }
      if (!local.pending.length && Object.keys(jerseyErrors(local.data, local.data.report)).length) {
        setError("LOCAL_DRAFT_INCOMPLETE"); return;
      }
      if (enqueue && !local.pending.length && local.revision > local.acknowledgedRevision) {
        local = await enqueueReport(actorId, matchId, "save");
        apply(local);
      }
      if (!local.pending.length) {
        const response = await fetch(`/api/match-reports/${matchId}`, { cache: "no-store", headers: { "X-Expected-Actor-Id": actorId }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new ReportClientError("REFERENCE_UNAVAILABLE", response.status);
        const reference = await response.json() as ReportDemoData;
        if (reference.match.version !== local.data.match.version || reference.report.version !== local.data.report.version || !reference.match.status.captureAllowed) {
          setComparison(reference); setError("SERVER_REFERENCE_CHANGED"); return;
        }
      }
      await synchronizeReport(actorId, matchId, apply, queuedLiveClocks.current);
      const latest = await readLocalReport(actorId, matchId);
      if (enqueue && latest && latest.revision === requestedRevision && !latest.pending.length && latest.revision > latest.acknowledgedRevision &&
          !Object.keys(jerseyErrors(latest.data, latest.data.report)).length) {
        apply(await enqueueReport(actorId, matchId, "save"));
        await synchronizeReport(actorId, matchId, apply);
      }
      setSessionExpired(false); setError("");
    } catch (failure) {
      queuedLiveClocks.current.clear();
      if (failure instanceof ReportClientError && failure.status === 401) setSessionExpired(true);
      else setError(failure instanceof ReportClientError ? failure.code : "SYNC_UNCERTAIN");
    } finally {
      syncBusy.current = false;
      const retry = syncAgain.current;
      syncAgain.current = false;
      if (mounted.current) {
        setSyncing(false);
        if (retry && queuedLiveClocks.current.size && navigator.onLine) void sync(false);
      }
    }
  }
  const syncOnConnection = useEffectEvent(() => void sync());
  useEffect(() => {
    mounted.current = true;
    const connection = () => {
      setConnected(navigator.onLine);
      if (navigator.onLine) syncOnConnection();
      else queuedLiveClocks.current.clear();
    };
    const expiredSession = () => setSessionExpired(true);
    connection();
    window.addEventListener("online", connection); window.addEventListener("offline", connection);
    window.addEventListener("report-session-expired", expiredSession);
    const unsubscribe = subscribeReports(() => {
      void readLocalReport(actorId, matchId).then(value => {
        if (!mounted.current) return;
        setAccountLocked(!value);
        if (!value) return;
        if (value.draftId !== current.current.draftId || value.revision > current.current.revision || value.revision === current.current.revision && value.editId !== current.current.editId) setOtherTab(value);
        apply(value);
      }).catch(() => setError("LOCAL_READ_FAILED"));
    });
    return () => { mounted.current = false; unsubscribe(); window.removeEventListener("online", connection); window.removeEventListener("offline", connection); window.removeEventListener("report-session-expired", expiredSession); };
  }, [actorId, matchId, apply]);
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, initial.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [initial.expiresAt]);
  const prepareOnOpen = useEffectEvent(() => void prepare());
  useEffect(() => {
    if (initial.prepared) return;
    const timer = setTimeout(() => { if (navigator.onLine) prepareOnOpen(); }, 0);
    return () => clearTimeout(timer);
  }, [initial.prepared]);
  async function run(kind: ReportOperation["kind"], action?: ReportOperation["clockAction"]) {
    if (operationBusy.current) return;
    operationBusy.current = true;
    const liveClock = kind === "clock" && navigator.onLine;
    setLocalOperation(true);
    try {
      await writes.current;
      const next = await enqueueReport(actorId, matchId, kind, action, current.current.editId);
      current.current = next; durableRevision.current = next.revision; setSavedRevision(next.revision); render(next);
      setLocalOperation(false);
      if (liveClock && navigator.onLine) queuedLiveClocks.current.add(next.pending.at(-1)!.operation.id);
      if (navigator.onLine) await sync(false);
    } catch (failure) { setError(failure instanceof ReportClientError ? failure.code : "LOCAL_WRITE_FAILED"); }
    finally { operationBusy.current = false; setLocalOperation(false); }
  }
  async function retryLocal() {
    setSaving(true);
    try {
      await writes.current.catch(() => undefined);
      await writeLocalReport(current.current, durableRevision.current);
      durableRevision.current = current.current.revision;
      setSavedRevision(current.current.revision);
      writes.current = Promise.resolve(); setError("");
    } catch { setError("LOCAL_WRITE_FAILED"); }
    finally { setSaving(false); }
  }
  async function prepare() {
    setPreparing(true);
    try { await writes.current; apply(await prepareLocalReport(actorId, matchId)); }
    catch { setError("PREPARATION_INCOMPLETE"); }
    finally { setPreparing(false); }
  }
  async function compare() {
    if (resolutionBusy.current || syncBusy.current || operationBusy.current) return;
    resolutionBusy.current = true; setResolving(true); setResolutionMessage("");
    try {
      const reference = await downloadOwnReport(actorId, matchId);
      const latest = await readLocalReport(actorId, matchId);
      if (!latest) throw Error("LOCAL_ACCOUNT_LOCKED");
      comparisonRecord.current = latest;
      setComparison(reference); setReviewAccepted(false); setCompareOpen(true);
    } catch { setResolutionMessage("No se pudo obtener una referencia autorizada. Revisa tu sesión y designación y vuelve a comparar."); }
    finally { resolutionBusy.current = false; setResolving(false); }
  }
  async function resolve(choice: ResolutionChoice) {
    if (!reviewAccepted || !comparison || !comparisonRecord.current || resolutionBusy.current || syncBusy.current || operationBusy.current) return;
    resolutionBusy.current = true; setResolving(true); setResolutionMessage("");
    try {
      await writes.current.catch(() => undefined);
      const next = await resolveReportConflict(current.current, comparisonRecord.current, comparison, choice);
      current.current = next; durableRevision.current = next.revision; writes.current = Promise.resolve();
      setSavedRevision(next.revision); render(next); setOtherTab(null); setError(""); setSessionExpired(false);
      setSaving(false); setCompareOpen(false); setComparison(null);
      setResolutionMessage(choice === "server" ? "Retomaste la versión del servidor. La captura anterior quedó conservada en este dispositivo."
        : "Nueva revisión local para revisar eventos y notas. El reloj y las alineaciones proceden del servidor. Repite las firmas y sincroniza después de revisar.");
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      setResolutionMessage(code === "RESOLUTION_REFERENCE_CHANGED" || code === "LOCAL_REVISION_CONFLICT"
        ? "Cambió una de las versiones durante la revisión. Vuelve a comparar antes de decidir."
        : "No se pudo completar la resolución. Conservamos la captura. Comprueba sesión, designación, conexión y espacio antes de reintentar.");
      setReviewAccepted(false);
    } finally { resolutionBusy.current = false; setResolving(false); }
  }
  const rejected = record.pending.find(item => item.error);
  const localFailed = !saving && savedRevision !== record.revision;
  const pending = record.revision > record.acknowledgedRevision || record.pending.length > 0;
  const locked = Boolean(resolving || localOperation || otherTab || rejected || expired || sessionExpired || error === "LOCAL_ACCOUNT_LOCKED" || error === "SERVER_REFERENCE_CHANGED");
  const receipt = record.lastReceipt;
  if (accountLocked) return <p role="alert">La copia está bloqueada. Para retomarla, inicia sesión con la cuenta que preparó el partido.</p>;
  const notice = <section aria-label="Guardado y sincronización" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
    <p className="text-sm font-semibold">{record.data.match.number} · Borrador {record.draftId.slice(0, 8)} · Revisión {record.revision}</p>
    <p role="status" aria-atomic="true" className="text-sm leading-6">{saving ? "Guardando en el dispositivo…" : localFailed ? `Falta guardar la revisión ${record.revision}. Sigue en memoria. Libera espacio y reintenta antes de salir.` : `Guardado en este dispositivo · Revisión ${savedRevision}.`} {pending && "Pendiente de sincronizar."} {connected ? "Con conexión." : "Sin conexión."}</p>
    {receipt && <p role="status" className="rounded-xl bg-positive-surface p-3 text-sm text-positive">Acuse de borrador · Revisión {receipt.revision} · Servidor v{receipt.receipt.reportVersion}. {record.revision > receipt.revision && "Hay cambios posteriores pendientes."} El cierre oficial sigue sujeto a confirmación.</p>}
    {record.reviewRequired && <p role="status" className="text-sm">Revisa tus eventos y notas sobre la referencia vigente. Pulsa Sincronizar cuando termines la revisión. Las capturas anteriores están conservadas abajo.</p>}
    {record.prepared && <a className={secondaryButton} href={`/offline/report?match=${matchId}`}>Abrir copia preparada sin conexión</a>}
    <div className="flex flex-wrap gap-2">
      <button className={secondaryButton} type="button" disabled={saving || syncing || locked || !connected || localFailed} onClick={() => void sync(true, true)}>{syncing ? "Consultando acuse y sincronizando…" : "Sincronizar"}</button>
      {!record.prepared && <button className={secondaryButton} type="button" disabled={preparing || !connected || saving} onClick={() => void prepare()}>{preparing ? "Preparando recursos…" : "Preparar para usar sin conexión"}</button>}
      {localFailed && <button type="button" className={primaryButton} onClick={() => void retryLocal()}>Reintentar guardado local</button>}
      {sessionExpired && <><ActionLink variant="secondary" href={`/login?callbackUrl=${encodeURIComponent("/offline/report?match=" + matchId)}`} target="_blank" rel="noopener noreferrer">Iniciar sesión en otra pestaña</ActionLink><button type="button" className={secondaryButton} onClick={() => void sync(false)}>Revisar sesión y acuse</button></>}
    </div>
    {expired && <p role="alert" className="text-sm text-danger">Venció la autorización local. Recupera conexión y revalida el partido antes de continuar.</p>}
    {sessionExpired && <p role="alert" className="text-sm text-danger">Tu sesión venció. La copia y la intención pendientes se conservan. Inicia sesión con la misma cuenta y revisa el acuse para continuar.</p>}
    {otherTab && <p role="alert" className="text-sm text-danger">Otra pestaña guardó la revisión {otherTab.revision}. Tu captura sigue en memoria. Compara las versiones antes de continuar.</p>}
    {(rejected || error && !localFailed) && <p role="alert" className="text-sm text-danger">{rejected ? reportErrorMessage(rejected.error!) : error === "LOCAL_DRAFT_INCOMPLETE" ? "Corrige los dorsales incompletos o repetidos antes de sincronizar. La edición sigue disponible." : error === "SERVER_REFERENCE_CHANGED" ? "La referencia del servidor cambió. Conservamos tu copia para compararla antes de continuar." : error === "PREPARATION_INCOMPLETE" ? "La preparación quedó incompleta. Reintenta con conexión y espacio disponible. En desarrollo utiliza el recorrido de producción." : error === "LOCAL_ACCOUNT_LOCKED" ? "La cuenta local se cerró o cambió. La captura está bloqueada." : "No se recibió el acuse. La intención original sigue pendiente. Recupera conexión y pulsa Sincronizar."}</p>}
    {resolutionMessage && <p role="status" className="text-sm leading-6">{resolutionMessage}</p>}
    {(otherTab || rejected || error === "SERVER_REFERENCE_CHANGED") && <button className={secondaryButton} type="button" disabled={resolving || saving || syncing || localOperation || !connected} onClick={() => void compare()}>{resolving ? "Consultando versiones…" : "Comparar versiones"}</button>}
    <FormDialog open={compareOpen} title="Resolver el conflicto de captura" description="Revisa las versiones y elige la copia con la que continuarás. Las capturas anteriores se conservarán en este dispositivo." pending={resolving} onClose={() => setCompareOpen(false)}
      footer={<div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} disabled={!reviewAccepted || resolving || !connected} onClick={() => void resolve("server")}>Usar versión del servidor</button>
        <button type="button" className={primaryButton} disabled={!reviewAccepted || resolving || !connected} onClick={() => void resolve("review")}>Revisar mis eventos y notas</button>
      </div>}>
      <div className="grid gap-3 sm:grid-cols-2">{[{ label: "Mi captura", data: record.data }, { label: "Servidor", data: comparison }, ...(otherTab ? [{ label: "Otra pestaña", data: otherTab.data }] : [])].map(item => <article key={item.label} className="min-w-0 rounded-xl border border-border p-3"><h3 className="font-semibold">{item.label} · v{item.data?.report.version}</h3><p className="text-sm">Marcador {item.data?.report.score.home ?? "–"} : {item.data?.report.score.away ?? "–"} · {item.data?.report.events.length} eventos</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.data?.report.remarks}</p><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({ ...item.data?.report, signatures: Object.fromEntries(Object.entries(item.data?.report.signatures ?? {}).map(([id, signature]) => [id, signature ? { ...signature, image: "Firma conservada" } : null])) }, null, 2)}</pre></article>)}</div>
      <p className="mt-4 text-sm leading-6">Retomar el servidor permite continuar desde su captura. Revisar tus eventos y notas crea un borrador pendiente de guardar, con el reloj y las alineaciones vigentes. Las firmas se capturan de nuevo. Al sincronizar se validarán otra vez permisos, versiones y reglas deportivas.</p>
      <label className="mt-4 flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" className="size-5 shrink-0 accent-[var(--action)]" checked={reviewAccepted} disabled={resolving} onChange={event => setReviewAccepted(event.target.checked)} />Revisé las versiones y la copia con la que continuaré.</label>
      {resolutionMessage && <p role="alert" className="mt-3 text-sm text-danger">{resolutionMessage}</p>}
    </FormDialog>
    {!!record.archives?.length && <details className="rounded-xl border border-border p-3">
      <summary className="min-h-12 cursor-pointer py-3 font-semibold">Capturas anteriores conservadas ({record.archives.length})</summary>
      {record.archives.map((archive, index) => <article key={index} className="space-y-2 border-t border-border py-3 text-sm">
        <h3 className="font-semibold">Borrador {archive.draftId.slice(0, 8)} · Revisión {archive.revision} · {archive.pending.length} intenciones conservadas</h3>
        <p className="whitespace-pre-wrap break-words">{archive.data.report.remarks}</p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({ ...archive.data.report, signatures: Object.fromEntries(Object.entries(archive.data.report.signatures).map(([id, signature]) => [id, signature ? { ...signature, image: "Firma conservada en este dispositivo" } : null])) }, null, 2)}</pre>
      </article>)}
    </details>}
  </section>;
  // Authorized photo URLs belong only to the current online view. The durable
  // snapshot and the public offline shell continue to exclude photographs.
  const photoUrls = new Map(connected ? serverReference?.players.map(player => [player.id, player.photoUrl]) : []);
  const viewData = { ...record.data, players: record.data.players.map(player => ({ ...player, photoUrl: photoUrls.get(player.id) ?? null })) };
  return <ReportWorkspace key={record.draftId} data={viewData} live={{ actorId }} device={{
    report: record.data.report, match: record.data.match, confirmation: record.data.confirmation, setReport, run: (kind, action) => void run(kind, action),
    locked, notice, safelyStored: !otherTab && !saving && !localFailed && savedRevision === record.revision,
  }} />;
}
