"use client";
import type { LiveRefereeControls } from "../types";
export function OperationFields({ live, reasonPlaceholder }: { live: Pick<LiveRefereeControls,"reason"|"onReasonChange"|"pending"|"uncertain"|"error"|"recover"|"retryReady"|"retry">; reasonPlaceholder?: string }) {
  return <div className="space-y-3"><label className="block text-sm font-semibold">Motivo de la operación<textarea required minLength={5} maxLength={500} value={live.reason} placeholder={reasonPlaceholder} disabled={live.pending || live.uncertain} onChange={e=>live.onReasonChange(e.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-border bg-surface p-3" /></label>
    {live.error && <p role="alert" className="text-sm text-danger">{live.error}</p>}
    {live.uncertain && <button type="button" disabled={live.pending} onClick={live.recover} className="min-h-12 rounded-xl border border-border px-4 py-3 text-sm font-semibold">Consultar resultado sin reenviar</button>}
    {live.retryReady && <button type="button" disabled={live.pending} onClick={live.retry} className="primary-action min-h-12 rounded-xl px-4 py-3 text-sm font-semibold">Reintentar la misma solicitud</button>}
  </div>;
}
