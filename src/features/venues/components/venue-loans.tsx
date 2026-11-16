"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { PrivateDocumentPreview } from "@/components/ui/private-document-preview";
import { SelectField } from "@/components/ui/select-field";
import type { VenueLoanWorkspace } from "../server/loan-workspace";

const primary = "primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50";
const secondary = "min-h-11 rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50";
const field = "mt-1 min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2";
const labels: Record<string, string> = { PENDING: "Pendiente", APPROVED: "Aprobada", REJECTED: "Rechazada" };
const emptyWindow = () => ({ id: crypto.randomUUID(), start: "", end: "" });

export function VenueLoans({ workspace }: { workspace: VenueLoanWorkspace }) {
  const router = useRouter();
  const [filter, setFilter] = useState("ALL");
  const [mode, setMode] = useState<"submit" | "review" | null>(null);
  const [selected, setSelected] = useState<VenueLoanWorkspace["rows"][number] | null>(null);
  const [preview, setPreview] = useState(false);
  const [contextId, setContextId] = useState("");
  const [venueId, setVenueId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [windows, setWindows] = useState<ReturnType<typeof emptyWindow>[]>([]);
  const [letter, setLetter] = useState<File | null>(null);
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    let body: BodyInit;
    const headers: Record<string, string> = { "X-Expected-Actor-Id": workspace.actorId };
    if (mode === "submit") {
      if (!context || !venueId || !letter) { setError("Elige club, temporada y cancha, y adjunta la carta."); return; }
      const form = new FormData();
      form.set("letter", letter);
      form.set("payload", JSON.stringify({ contextId, venueId, requestId, windows: windows.map(({ start, end }) => ({ start, end })) }));
      body = form;
    } else {
      if (!selected || !decision) { setError("Selecciona una decisión."); return; }
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({ kind: "decide", requestId: selected.id, status: decision, reason });
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/venue-loans", { method: "POST", headers, body, signal: AbortSignal.timeout(45000) });
      if (!response.ok) {
        setError(response.status === 403 ? "Tu cuenta no tiene permiso para esta operación."
          : response.status === 400 || response.status === 413 ? "Revisa los horarios, el motivo y el tipo o tamaño del archivo."
          : "No se confirmó el cambio. Conserva los datos y reintenta el mismo envío.");
        return;
      }
      setNotice(mode === "submit" ? "Solicitud registrada." : "Decisión registrada.");
      setMode(null);
      router.refresh();
    } catch {
      setError("No se confirmó el cambio. Conserva los datos y reintenta el mismo envío.");
    } finally { setPending(false); }
  }

  return <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-muted">Competencias / Canchas</p><h1 className="text-3xl font-semibold">Préstamos de canchas</h1>
        <p className="mt-2 text-sm text-muted">Solicitudes con carta privada y horarios de uso.</p></div>
      {workspace.contexts.some(c => c.venues.length > 0) && <button className={primary} onClick={() => {
        setContextId(""); setVenueId(""); setLetter(null); setRequestId(crypto.randomUUID());
        setWindows([emptyWindow()]); setError(""); setMode("submit");
      }}>Solicitar préstamo</button>}
    </header>
    {notice && <p role="status">{notice}</p>}
    {!!workspace.rows.length && <div className="max-w-xs"><label htmlFor="loan-status" className="text-sm font-semibold">Estado</label>
      <SelectField id="loan-status" value={filter} onValueChange={setFilter} searchable={false}
        options={[{ value: "ALL", label: "Todos" }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]} /></div>}
    {rows.length === 0 && <p className="rounded-2xl border border-border bg-surface p-5 text-muted">No hay solicitudes para mostrar.</p>}
    <div className="grid gap-4 md:grid-cols-2">{rows.map(row => <article key={row.id} className="space-y-3 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="text-lg font-semibold">{row.venue}</h2>
        <span className="rounded-full border border-border px-3 py-1 text-sm">{labels[row.status] ?? row.status}</span></div>
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
      {row.reason && <p className="text-sm">{row.reason}</p>}
      {row.review && <button className={secondary} onClick={() => {
        setSelected(row); setDecision(""); setReason(""); setError(""); setMode("review");
      }}>Revisar</button>}
    </article>)}</div>
    {mode && <FormDialog open title={mode === "submit" ? "Solicitar préstamo" : "Revisar solicitud"}
      description={mode === "submit" ? "Elige el contexto y adjunta la carta." : `${selected?.venue} · ${selected?.club}`}
      pending={pending} dirty={mode === "submit" ? Boolean(contextId || letter) : Boolean(decision || reason)}
      onClose={() => setMode(null)}>
      <form className="space-y-4" onSubmit={submit}>
        <fieldset className="space-y-4" disabled={pending}>
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
            <label className="block">Carta privada (PDF, PNG o JPEG; máximo 10 MB)<input className={field} type="file" required
              accept="application/pdf,image/png,image/jpeg" onChange={e => setLetter(e.target.files?.[0] ?? null)} /></label>
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
        <button className={primary} disabled={pending}>{pending ? "Guardando…" : mode === "submit" ? "Enviar solicitud" : "Guardar decisión"}</button>
      </form>
    </FormDialog>}
    {preview && request && <PrivateDocumentPreview actorId={workspace.actorId} request={request} onClose={() => setPreview(false)} />}
  </div>;
}
