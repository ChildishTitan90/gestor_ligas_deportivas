"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { DirectSignatureField } from "@/components/ui/direct-signature-field";
import { FormDialog } from "@/components/ui/form-dialog";
import { PrivateDocumentPreview } from "@/components/ui/private-document-preview";
import { ProcessSteps } from "@/components/ui/process-steps";
import { SelectField } from "@/components/ui/select-field";
import type { VenueLoanWorkspace } from "../server/loan-workspace";
import { sendVenueLoan, venueLoanRecoveryStore, type VenueLoanCapture } from "../venue-loan-recovery.client";

const primary = "primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50";
const secondary = "min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50";
const field = "mt-1 min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2";
const labels: Record<string, string> = { PENDING: "Pendiente", APPROVED: "Aprobada", REJECTED: "Rechazada" };
const emptyWindow = () => ({ id: crypto.randomUUID(), start: "", end: "" });

function LoanProgress({ row }: { row: VenueLoanWorkspace["rows"][number] }) {
  if (!Object.hasOwn(labels, row.status)) return <div className="space-y-2 text-sm">
    <p>{row.status}</p>
    {row.reason && <p className="text-muted">{row.reason}</p>}
  </div>;
  const leagueStage = row.reviewStage === "LEAGUE";
  const reviewer = leagueStage ? "la liga" : "el club dueño";
  const steps = row.ownerReviewRequired ? ["Solicitud", "Club dueño", "Liga"] : ["Solicitud", "Liga"];
  const completedSteps = row.ownerReviewRequired
    ? [true, leagueStage, row.status === "APPROVED"]
    : [true, row.status === "APPROVED"];
  const message = row.status === "APPROVED" ? "Uso autorizado en los horarios aprobados."
    : row.status === "REJECTED" ? `Rechazada por ${reviewer}.`
      : `Pendiente de revisión por ${reviewer}.`;
  const reasonLabel = row.status === "PENDING" ? "Observación del club dueño" : "Motivo de la decisión";
  return <div className="min-w-0 space-y-2">
    <ProcessSteps label={`Etapas del préstamo de ${row.venue}`} steps={steps}
      current={row.ownerReviewRequired && leagueStage ? 2 : 1} completedSteps={completedSteps} />
    <p className="text-sm font-medium text-primary">{message}</p>
    {row.reason && <p className="text-sm text-muted">{reasonLabel}. {row.reason}</p>}
  </div>;
}

export function VenueLoans({ workspace }: { workspace: VenueLoanWorkspace }) {
  const router = useRouter();
  const busy = useRef(false);
  const [opening, setOpening] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<VenueLoanCapture | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [mode, setMode] = useState<"submit" | "review" | null>(null);
  const [selected, setSelected] = useState<VenueLoanWorkspace["rows"][number] | null>(null);
  const [preview, setPreview] = useState(false);
  const [contextId, setContextId] = useState("");
  const [venueId, setVenueId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [windows, setWindows] = useState<ReturnType<typeof emptyWindow>[]>([]);
  const [letter, setLetter] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const context = workspace.contexts.find(c => c.id === contextId);
  const request = useMemo(() => selected ? {
    label: "Carta de préstamo", path: "/api/venue-loans", body: { kind: "preview", requestId: selected.id },
  } : null, [selected]);
  const rows = workspace.rows.filter(row => filter === "ALL" || row.status === filter);
  const canRequest = Boolean(unconfirmed) || workspace.contexts.some(context => context.venues.length > 0);

  const store = venueLoanRecoveryStore(workspace.actorId);

  async function openRequest() {
    if (busy.current) return;
    busy.current = true;
    setOpening(true);
    setError("");
    try {
      const saved = await store.read();
      if (saved && workspace.rows.some(row => row.id === saved.requestId)) {
        await store.remove(saved.requestId);
        setUnconfirmed(null);
        setNotice("Solicitud registrada. Consulta su estado en el listado.");
        return;
      }
      setUnconfirmed(saved ?? null);
      setContextId(saved?.contextId ?? "");
      setVenueId(saved?.venueId ?? "");
      setLetter(saved?.letter ?? null);
      setSignature(null);
      setRequestId(saved?.requestId ?? crypto.randomUUID());
      setWindows(saved?.windows ?? [emptyWindow()]);
      setMode("submit");
    } catch {
      setError("No se pudo consultar la solicitud pendiente en este navegador.");
    } finally {
      setOpening(false);
      busy.current = false;
    }
  }

  async function cleanCancelledFiles() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/venue-loans", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Expected-Actor-Id": workspace.actorId },
        body: JSON.stringify({ kind: "cleanup" }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error("CLEANUP_FAILED");
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("cleaned" in result) || !("failed" in result) ||
        typeof result.cleaned !== "number" || typeof result.failed !== "number") throw new Error("CLEANUP_FAILED");
      setNotice(`Se revisaron ${result.cleaned} registros. ${result.failed} no se pudieron procesar.`);
    } catch {
      setError("No se pudo completar la limpieza. Puedes volver a intentarlo.");
    } finally {
      setPending(false);
      busy.current = false;
    }
  }

  async function resolveLegacyCapture() {
    if (!unconfirmed || unconfirmed.signature || busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/venue-loans", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Expected-Actor-Id": workspace.actorId },
        body: JSON.stringify({ kind: "resolve-legacy", requestId: unconfirmed.requestId, contextId: unconfirmed.contextId }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error("UNCONFIRMED");
      const result = await response.json();
      if (result.id !== unconfirmed.requestId || !["registered", "cancelled"].includes(result.outcome))
        throw new Error("UNCONFIRMED");
      await store.remove(unconfirmed.requestId);
      setUnconfirmed(null);
      if (result.outcome === "registered") {
        setNotice("Solicitud registrada. Consulta su estado en el listado.");
        setMode(null);
        router.refresh();
      } else {
        setRequestId(crypto.randomUUID());
        setSignature(null);
        setNotice("La captura anterior se cerró. Confirma tu firma para enviar la solicitud.");
      }
    } catch {
      setError("No se pudo comprobar la captura anterior. Vuelve a intentarlo.");
    } finally {
      setPending(false);
      busy.current = false;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;

    const isRequest = mode === "submit";
    if (isRequest && !unconfirmed && (!context || !venueId || !letter || !signature)) { setError("Elige club, temporada y cancha, adjunta la carta y confirma tu firma."); return; }
    if (!isRequest && (!selected || !decision)) { setError("Selecciona una decisión."); return; }

    busy.current = true;
    setPending(true);
    setError("");
    const send = (body: BodyInit) => fetch("/api/venue-loans", {
      method: "POST",
      headers: {
        "X-Expected-Actor-Id": workspace.actorId,
        ...(!isRequest && { "Content-Type": "application/json" }),
      },
      body,
      signal: AbortSignal.timeout(45000),
    });
    try {
      if (isRequest) {
        let capture = unconfirmed;
        if (!capture && context && letter && signature) {
          capture = { contextId, venueId, requestId, windows, letter, signature };
        }
        if (!capture) return;
        const result = await sendVenueLoan(store, capture, Boolean(unconfirmed), send);
        if (result === "uncertain") {
          setUnconfirmed(capture);
          setError("Abre de nuevo la solicitud para consultar si ya aparece registrada o reintenta el mismo envío.");
          router.refresh();
          return;
        }
        setUnconfirmed(null);
        if (result !== "confirmed") {
          setError(result === "denied" ? "Tu cuenta no tiene permiso para esta operación."
            : "Revisa los horarios y el tipo o tamaño del archivo.");
          return;
        }
        setLetter(null);
        setSignature(null);
      } else {
        const response = await send(JSON.stringify({ kind: "decide", requestId: selected?.id, status: decision, reason }));
        if (!response.ok) {
          setError(response.status === 403 ? "Tu cuenta no tiene permiso para esta operación."
            : response.status === 400 ? "Revisa el motivo."
            : "No se confirmó la decisión. Reintenta el mismo envío.");
          return;
        }
      }
      setNotice(isRequest ? "Solicitud registrada." : "Decisión registrada.");
      setMode(null);
      router.refresh();
    } catch {
      setError(isRequest ? "No se pudo guardar la captura en el navegador. Cierra y abre el formulario para recuperar un envío pendiente."
        : "No se confirmó la decisión. Reintenta el mismo envío.");
    } finally {
      setPending(false);
      busy.current = false;
    }
  }

  return <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
    <ManagementPageHeader title="Préstamos de canchas"
      description="Consulta quién revisa cada solicitud y qué horarios se autorizaron. La reserva de cada partido se confirma al programarlo."
      back={{ href: "/access", label: "Volver al panel" }} />
    {(canRequest || workspace.canClean) && <div className="flex flex-wrap items-center gap-3">
      {canRequest &&
        <button className={primary} disabled={opening} onClick={openRequest}>
          {unconfirmed ? "Recuperar solicitud" : "Solicitar préstamo"}
        </button>}
      {workspace.canClean && <button type="button" className={secondary} disabled={pending} onClick={cleanCancelledFiles}>
        {pending && !mode ? "Revisando archivos…" : "Limpiar archivos pendientes"}
      </button>}
    </div>}
    {notice && <p role="status">{notice}</p>}
    {!mode && error && <p role="alert">{error}</p>}
    {!!workspace.rows.length && <div className="max-w-xs"><label htmlFor="loan-status" className="text-sm font-semibold">Estado</label>
      <SelectField id="loan-status" value={filter} onValueChange={setFilter} searchable={false}
        options={[{ value: "ALL", label: "Todos" }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]} /></div>}
    {rows.length === 0 && <p className="rounded-2xl border border-border bg-surface p-5 text-muted">No hay solicitudes para mostrar.</p>}
    <div className="space-y-3">{rows.map(row => <article key={row.id}
      className="grid gap-4 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] sm:gap-6">
      <div className="min-w-0 space-y-2">
        <h2 className="text-lg font-semibold text-primary">{row.venue}</h2>
        <p className="text-sm text-muted">{row.club} · {row.season}</p>
        <div className="space-y-1 text-sm">
          <h3 className="font-semibold">{row.status === "APPROVED" ? "Horarios aprobados" : "Horarios solicitados"}</h3>
          {row.windows.length > 0 ? <>
            <p className="text-muted">{row.zone}</p>
            <ul className="list-disc space-y-1 pl-5">
              {row.windows.map(window => <li key={window}>{window}</li>)}
            </ul>
          </> : <p className="text-muted">No hay horarios registrados.</p>}
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        <LoanProgress row={row} />
        {row.review && <button className={secondary} onClick={() => {
          setSelected(row); setDecision(""); setReason(""); setError(""); setMode("review");
        }}>Revisar</button>}
      </div>
    </article>)}</div>
    {mode && <FormDialog open title={mode === "submit" ? "Solicitar préstamo" : "Revisar solicitud"}
      description={mode === "submit" ? "Elige el contexto y adjunta la carta." : `${selected?.venue} · ${selected?.club}`}
      pending={pending} uncertain={mode === "submit" && Boolean(unconfirmed)} dirty={mode === "submit" ? Boolean(contextId || letter) : Boolean(decision || reason)}
      onClose={() => setMode(null)}>
      <form className="space-y-4" onSubmit={submit}>
        {mode === "submit" && unconfirmed && <p role="status">
          {unconfirmed.signature ? "Resultado sin confirmar. La carta, la firma y los horarios se conservan en este navegador."
            : "Esta captura anterior necesita comprobarse antes de volver a firmar."}
        </p>}
        <fieldset className="space-y-4" disabled={pending || (mode === "submit" && Boolean(unconfirmed))}>
          {mode === "submit" ? <>
            <label className="block">Club y temporada<SelectField value={contextId} onValueChange={value => { setContextId(value); setVenueId(""); }}
              options={workspace.contexts.filter(c => c.venues.length).map(c => ({ value: c.id, label: c.label }))} /></label>
            <label className="block">Cancha<SelectField value={venueId} onValueChange={setVenueId} disabled={!context} options={context?.venues ?? []} /></label>
            {context && <p className="text-sm text-muted">Zona horaria: {context.zone}</p>}
            {windows.map((window, index) => <div key={window.id} className="grid gap-2 sm:grid-cols-2">
              <label>Inicio {index + 1}<input className={field} type="datetime-local" required value={window.start}
                onChange={e => setWindows(previous => previous.map(w => w.id === window.id ? { ...w, start: e.target.value } : w))} /></label>
              <label>Fin {index + 1}<input className={field} type="datetime-local" required value={window.end}
                onChange={e => setWindows(previous => previous.map(w => w.id === window.id ? { ...w, end: e.target.value } : w))} /></label>
              {windows.length > 1 && <button type="button" className="justify-self-start text-sm underline" onClick={() => setWindows(previous => previous.filter(w => w.id !== window.id))}>Quitar horario {index + 1}</button>}
            </div>)}
            {windows.length < 50 && <button type="button" className="text-sm underline" onClick={() => setWindows(previous => [...previous, emptyWindow()])}>Agregar horario</button>}
            <label className="block">Carta privada (PDF, PNG o JPEG; máximo 10 MB)<input className={field} type="file" required={!letter}
              accept="application/pdf,image/png,image/jpeg" onChange={e => setLetter(e.target.files?.[0] ?? null)} /></label>
            {letter && <p className="text-sm text-muted">Carta adjunta · {letter.name}</p>}
            {!unconfirmed && <DirectSignatureField label="Firma del delegado" disabled={pending} onChange={setSignature} />}
          </> : <>
            <p className="text-sm text-muted">Horarios solicitados · {selected?.zone}</p>
            <ul className="list-disc pl-5 text-sm">{selected?.windows.map(window => <li key={window}>{window}</li>)}</ul>
            <button type="button" className={secondary} onClick={() => setPreview(true)}>Ver carta privada</button>
            <label className="block">Decisión<SelectField value={decision} onValueChange={setDecision} searchable={false}
              options={[{ value: "APPROVED", label: "Aprobar" }, { value: "REJECTED", label: "Rechazar" }]} /></label>
            <label className="block">Motivo<textarea className={field} required minLength={8} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
          </>}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {mode === "submit" && unconfirmed && !unconfirmed.signature
          ? <button type="button" className={primary} disabled={pending} onClick={resolveLegacyCapture}>Comprobar captura anterior</button>
          : <button className={primary} disabled={pending}>{pending ? "Guardando…" : mode === "submit" ? (unconfirmed ? "Reintentar solicitud" : "Enviar solicitud") : "Guardar decisión"}</button>}
      </form>
    </FormDialog>}
    {preview && request && <PrivateDocumentPreview actorId={workspace.actorId} request={request} onClose={() => setPreview(false)} />}
  </div>;
}
