"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { FormDialog } from "@/components/ui/form-dialog";
import { createReportClient, ReportClientError, type ReportOperation } from "../report-client";
import type { MatchReportPresentation, ReportDemoData } from "../types";
import { reportErrorMessage } from "../feedback";
import { jerseyErrors } from "../lineup-rules";
import { readLocalReport, writeLocalReport, subscribeReports, type LocalReport, authorizeLocalAccount } from "../offline/store.client";
import { downloadOwnReport, prepareLocalReport } from "../offline/prepare.client";
import { offlineSupport } from "../offline/resources.client";
import { enqueueReport, synchronizeReport } from "../offline/sync.client";
import { ReportWorkspace } from "./report-workspace";
import { primaryButton, secondaryButton } from "./report-shared";

export type ReportDeviceControls = {
  report: MatchReportPresentation; match: ReportDemoData["match"];
  confirmation: ReportDemoData["confirmation"];
  setReport: Dispatch<SetStateAction<MatchReportPresentation>>;
  run(kind: ReportOperation["kind"], action?: ReportOperation["clockAction"]): void;
  locked: boolean; notice: ReactNode; safelyStored: boolean;
};

export function ReportDeviceWorkspace({ actorId, initialData, restored }: { actorId: string; initialData?: ReportDemoData; restored?: LocalReport }) {
  const [record, setRecord] = useState<LocalReport | null>(restored ?? null);
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState("");
  const [unsupported, setUnsupported] = useState(false);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (restored) return;
    let alive = true;
    void Promise.resolve().then(async () => {
      if (!offlineSupport()) { if (alive) setUnsupported(true); return undefined; }
      return readLocalReport(actorId, initialData!.match.id);
    }).then(value => {
      if (!alive) return;
      if (value?.prepared) setRecord(value);
      else setConsent(true);
    }).catch(() => { if (alive) setProblem("No se pudo abrir el almacenamiento. Libera espacio o habilita el almacenamiento del navegador y vuelve a preparar el partido."); });
    return () => { alive = false; };
  }, [actorId, initialData, restored]);

  async function begin() {
    setStarting(true); setProblem("");
    try {
      await downloadOwnReport(actorId, initialData!.match.id);
      await authorizeLocalAccount(actorId);
      const next = await prepareLocalReport(actorId, initialData!.match.id);
      setRecord(next); setConsent(false);
    } catch { setProblem("No se pudo habilitar el borrador local. Comprueba sesión, designación y espacio antes de reintentar."); }
    finally { setStarting(false); }
  }
  if (record) return <DeviceCapture key={record.draftId} initial={record} serverReference={initialData} />;
  if (initialData && !initialData.match.status.captureAllowed) return <ReportWorkspace data={initialData} live={{ actorId }} />;
  return <section className="mx-auto max-w-3xl space-y-4 rounded-2xl border border-border bg-surface p-5">
    <h1 className="text-2xl font-semibold text-primary">Prepara el partido antes de capturar</h1>
    <p className="text-sm leading-6">El borrador se guardará desde la primera edición, incluidas las firmas. La autorización local dura siete días. Al cerrar sesión explícitamente se eliminarán las copias locales, con advertencia si hay pendientes. Una sesión vencida permite retomar tras identificarte con la misma cuenta.</p>
    <p className="text-sm leading-6 text-muted">Usa un dispositivo personal con bloqueo de pantalla. La copia contiene nombres, elegibilidad y captura del partido. El almacenamiento del navegador puede eliminarse por falta de espacio.</p>
    {(problem || unsupported) && <p role="alert" className="text-sm text-danger">{problem || "Este navegador no reúne los requisitos offline. Usa un navegador compatible con HTTPS o localhost para preparar la cédula."}</p>}
    <button className={primaryButton} type="button" disabled={!consent || starting || unsupported} onClick={() => void begin()}>{starting ? "Preparando partido y recursos…" : consent ? "Aceptar y preparar" : "Consultando copia local…"}</button>
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
  const [sessionExpired, setSessionExpired] = useState(false);
  const [connected, setConnected] = useState(true);
  const [otherTab, setOtherTab] = useState<LocalReport | null>(null);
  const [comparison, setComparison] = useState<ReportDemoData | null>(serverReference ?? null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const syncBusy = useRef(false);
  const operationBusy = useRef(false);
  const mounted = useRef(true);
  const { actorId, matchId } = initial;
  const apply = useCallback((incoming: LocalReport) => {
    const local = current.current;
    const next = { ...incoming, revision: local.revision, editId: local.editId, data: {
      ...local.data, confirmation: incoming.data.confirmation, match: { ...local.data.match, version: incoming.data.match.version },
      report: { ...local.data.report, id: incoming.data.report.id, version: incoming.data.report.version,
        lineupsLock: local.data.report.lineupsLock ?? incoming.data.report.lineupsLock, clock: local.data.report.clock ?? incoming.data.report.clock },
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
  async function sync(enqueue = true) {
    if (syncBusy.current || !navigator.onLine) return;
    syncBusy.current = true; setSyncing(true);
    const requestedRevision = current.current.revision;
    try {
      await writes.current;
      let local = await readLocalReport(actorId, matchId);
      if (!local) throw Error("LOCAL_ACCOUNT_LOCKED");
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
      await synchronizeReport(actorId, matchId, apply);
      const latest = await readLocalReport(actorId, matchId);
      if (enqueue && latest && latest.revision === requestedRevision && !latest.pending.length && latest.revision > latest.acknowledgedRevision &&
          !Object.keys(jerseyErrors(latest.data, latest.data.report)).length) {
        apply(await enqueueReport(actorId, matchId, "save"));
        await synchronizeReport(actorId, matchId, apply);
      }
      setSessionExpired(false); setError("");
    } catch (failure) {
      if (failure instanceof ReportClientError && failure.status === 401) setSessionExpired(true);
      else setError(failure instanceof ReportClientError ? failure.code : "SYNC_UNCERTAIN");
    } finally { syncBusy.current = false; if (mounted.current) setSyncing(false); }
  }
  const syncOnConnection = useEffectEvent(() => void sync());
  useEffect(() => {
    mounted.current = true;
    const connection = () => { setConnected(navigator.onLine); if (navigator.onLine) syncOnConnection(); };
    const expiredSession = () => setSessionExpired(true);
    connection();
    window.addEventListener("online", connection); window.addEventListener("offline", connection);
    window.addEventListener("report-session-expired", expiredSession);
    const unsubscribe = subscribeReports(() => {
      void readLocalReport(actorId, matchId).then(value => {
        if (!mounted.current) return;
        if (!value) { setError("LOCAL_ACCOUNT_LOCKED"); return; }
        if (value.revision > current.current.revision || value.revision === current.current.revision && value.editId !== current.current.editId) setOtherTab(value);
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
    setLocalOperation(true);
    try {
      await writes.current;
      const next = await enqueueReport(actorId, matchId, kind, action, current.current.editId);
      current.current = next; durableRevision.current = next.revision; setSavedRevision(next.revision); render(next);
      setLocalOperation(false);
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
  const rejected = record.pending.find(item => item.error);
  const localFailed = !saving && savedRevision !== record.revision;
  const pending = record.revision > record.acknowledgedRevision || record.pending.length > 0;
  const locked = Boolean(localOperation || otherTab || rejected || expired || sessionExpired || error === "LOCAL_ACCOUNT_LOCKED" || error === "SERVER_REFERENCE_CHANGED");
  const receipt = record.lastReceipt;
  const notice = <section aria-label="Guardado y sincronización" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
    <p className="text-sm font-semibold">{record.data.match.number} · Borrador {record.draftId.slice(0, 8)} · Revisión {record.revision}</p>
    <p role="status" aria-atomic="true" className="text-sm leading-6">{saving ? "Guardando en el dispositivo…" : localFailed ? `Falta guardar la revisión ${record.revision}. Sigue en memoria. Libera espacio y reintenta antes de salir.` : `Guardado en este dispositivo · Revisión ${savedRevision}.`} {pending && "Pendiente de sincronizar."} {connected ? "Con conexión." : "Sin conexión."}</p>
    {receipt && <p role="status" className="rounded-xl bg-positive-surface p-3 text-sm text-positive">Acuse de borrador · Revisión {receipt.revision} · Servidor v{receipt.receipt.reportVersion}. {record.revision > receipt.revision && "Hay cambios posteriores pendientes."} El cierre oficial sigue sujeto a confirmación.</p>}
    {record.prepared && <a className={secondaryButton} href={`/offline/report?match=${matchId}`}>Abrir copia preparada sin conexión</a>}
    <div className="flex flex-wrap gap-2">
      <button className={secondaryButton} type="button" disabled={saving || syncing || locked || !connected || localFailed} onClick={() => void sync()}>{syncing ? "Consultando acuse y sincronizando…" : "Sincronizar"}</button>
      {!record.prepared && <button className={secondaryButton} type="button" disabled={preparing || !connected || saving} onClick={() => void prepare()}>{preparing ? "Preparando recursos…" : "Preparar para usar sin conexión"}</button>}
      {localFailed && <button type="button" className={primaryButton} onClick={() => void retryLocal()}>Reintentar guardado local</button>}
      {sessionExpired && <><ActionLink variant="secondary" href={`/login?callbackUrl=${encodeURIComponent("/offline/report?match=" + matchId)}`} target="_blank" rel="noopener noreferrer">Iniciar sesión en otra pestaña</ActionLink><button type="button" className={secondaryButton} onClick={() => void sync(false)}>Revisar sesión y acuse</button></>}
    </div>
    {expired && <p role="alert" className="text-sm text-danger">Venció la autorización local. Recupera conexión y revalida el partido antes de continuar.</p>}
    {sessionExpired && <p role="alert" className="text-sm text-danger">Tu sesión venció. La copia y la intención pendientes se conservan. Inicia sesión con la misma cuenta y revisa el acuse para continuar.</p>}
    {otherTab && <p role="alert" className="text-sm text-danger">Otra pestaña guardó la revisión {otherTab.revision}. Tu captura sigue en memoria. Compara las versiones antes de continuar.</p>}
    {(rejected || error && !localFailed) && <p role="alert" className="text-sm text-danger">{rejected ? reportErrorMessage(rejected.error!) : error === "LOCAL_DRAFT_INCOMPLETE" ? "Corrige los dorsales incompletos o repetidos antes de sincronizar. La edición sigue disponible." : error === "SERVER_REFERENCE_CHANGED" ? "La referencia del servidor cambió. Conservamos tu copia para compararla antes de continuar." : error === "PREPARATION_INCOMPLETE" ? "La preparación quedó incompleta. Reintenta con conexión y espacio disponible. En desarrollo utiliza el recorrido de producción." : error === "LOCAL_ACCOUNT_LOCKED" ? "La cuenta local se cerró o cambió. La captura está bloqueada." : "No se recibió el acuse. La intención original sigue pendiente. Recupera conexión y pulsa Sincronizar."}</p>}
    {(otherTab || rejected || error === "SERVER_REFERENCE_CHANGED") && <button className={secondaryButton} type="button" onClick={() => {
      if (error === "SERVER_REFERENCE_CHANGED" && comparison) { setCompareOpen(true); return; }
      if (otherTab) { setComparison(otherTab.data); setCompareOpen(true); return; }
      void createReportClient(actorId, record.data).query(record.pending[0].operation.id).then(() =>
        fetch(`/api/match-reports/${matchId}`, { cache: "no-store", headers: { "X-Expected-Actor-Id": actorId } })
      ).then(async response => { if (!response.ok) throw Error(); setComparison(await response.json()); setCompareOpen(true); }).catch(() => setError("COMPARISON_UNAVAILABLE"));
    }}>Comparar versiones</button>}
    <FormDialog open={compareOpen} title="Revisar las dos capturas" description="Conserva el borrador local mientras revisas la referencia. La conciliación requiere una decisión humana." onClose={() => setCompareOpen(false)}>
      <div className="grid gap-3 sm:grid-cols-2">{[{ label: "Mi captura", data: record.data }, { label: otherTab ? "Otra pestaña" : "Servidor", data: comparison }].map(item => <article key={item.label} className="min-w-0 rounded-xl border border-border p-3"><h3 className="font-semibold">{item.label} · v{item.data?.report.version}</h3><p className="text-sm">Marcador {item.data?.report.score.home ?? "–"} : {item.data?.report.score.away ?? "–"} · {item.data?.report.events.length} eventos</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(item.data?.report, null, 2)}</pre></article>)}</div>
    </FormDialog>
  </section>;
  return <ReportWorkspace data={record.data} live={{ actorId }} device={{
    report: record.data.report, match: record.data.match, confirmation: record.data.confirmation, setReport, run: (kind, action) => void run(kind, action),
    locked, notice, safelyStored: !otherTab && !saving && !localFailed && savedRevision === record.revision,
  }} />;
}
