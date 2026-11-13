"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { availableMatchActions } from "../transition-presentation";
import { transitionMatchAction } from "../transition-actions";

type Action = ReturnType<typeof availableMatchActions>[number];
const labels: Record<string, string> = { DRAFT: "Borrador", SCHEDULED: "Programado", CONFIRMED: "Confirmado", IN_PROGRESS: "En curso", SUSPENDED: "Suspendido", CANCELED: "Cancelado", FINISHED: "Finalizado", UNDER_REVIEW: "En revisión", NO_SHOW: "No presentado", RESCHEDULED: "Reprogramado", UNSCHEDULED: "No programado", ADMINISTRATIVELY_RESOLVED: "Resuelto administrativamente" };
export function MatchTransitionControls({ id, version, status, canRecordMatch, canSchedule = false, canCancel = false }: { id: string; version: number; status: string; canRecordMatch: boolean; canSchedule?: boolean; canCancel?: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pending, startTransition] = useTransition();
  const actions = availableMatchActions(status, { canSchedule, canCancel, canRecordMatch });
  function open(action: Action) { setSelected(action); setReason(""); setConfirmed(false); setMessage(""); setUncertain(false); setOperationId(crypto.randomUUID()); }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !confirmed || !reason.trim() || pending || uncertain) return;
    startTransition(async () => {
      try {
        const result = await transitionMatchAction({ matchId: id, expectedVersion: version, operationId, toStatus: selected.toStatus, reason });
        if (!result.ok) { setMessage(result.code === "FORBIDDEN" ? "Ya no tienes autorización para esta acción." : result.code === "STALE_MATCH" ? "El partido cambió. Actualiza la página para consultar su estado." : "No se pudo confirmar el cambio. Consulta el estado actualizado."); setUncertain(true); return; }
        setSelected(null); setMessage("Estado actualizado."); router.refresh();
      } catch { setMessage("No se pudo confirmar el resultado. Consulta el estado actualizado antes de volver a intentarlo."); setUncertain(true); }
    });
  }
  return <div className="space-y-3"><p>Estado: {labels[status] ?? "Estado no disponible"}</p>{!selected && <p role="status">{message}</p>}
    {actions.map(action => <button key={action.toStatus} onClick={() => open(action)} className="mr-2 min-h-12 rounded-xl border border-border px-4 font-semibold text-primary">{action.label}</button>)}
    <FormDialog open={!!selected} title={selected?.label ?? "Cambiar estado"} description="Registra el motivo y confirma el cambio." dirty={!!reason || confirmed} pending={pending} uncertain={uncertain} onClose={() => setSelected(null)}>
      <form onSubmit={submit} className="space-y-4"><p role="status">{message}</p><label className="block">Motivo<textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={pending || uncertain} className="block w-full rounded-xl border border-border bg-surface p-3" /></label>
        <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={pending || uncertain} /> Confirmo este cambio de estado.</label>
        {uncertain ? <button type="button" onClick={() => { setSelected(null); router.refresh(); }} className="min-h-12 rounded-xl border border-border px-4">Consultar estado actualizado</button> : <button disabled={pending || !confirmed || !reason.trim()} className="min-h-12 rounded-xl bg-primary px-4 font-semibold text-white disabled:opacity-50">{pending ? "Guardando…" : "Confirmar"}</button>}
      </form>
    </FormDialog>
  </div>;
}
