"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { availableMatchActions } from "../transition-presentation";
import { transitionMatchAction } from "../transition-actions";
import type { TransitionInput } from "../schemas";

type Action = ReturnType<typeof availableMatchActions>[number];
const labels: Record<string, string> = { DRAFT: "Borrador", SCHEDULED: "Programado", CONFIRMED: "Confirmado", IN_PROGRESS: "En curso", SUSPENDED: "Suspendido", CANCELED: "Cancelado", FINISHED: "Finalizado", UNDER_REVIEW: "En revisión", NO_SHOW: "No presentado", RESCHEDULED: "Reprogramado", UNSCHEDULED: "No programado", ADMINISTRATIVELY_RESOLVED: "Resuelto administrativamente" };
const errors: Record<string, string> = {
  FORBIDDEN: "Ya no tienes autorización para esta acción.",
  STALE_MATCH: "El partido cambió. Actualiza la página para consultar su estado.",
  MAIN_REFEREE_REQUIRED: "Falta una designación principal de árbitro aprobada y vigente.",
  SCHEDULE_REQUIRED: "El partido necesita cancha y horario válidos.",
  MATCH_REPORT_EXISTS: "El partido tiene una cédula o resultado y requiere revisión antes de cancelarlo.",
  SEASON_CLOSED: "La temporada está cerrada y no permite este cambio.",
  IDEMPOTENCY_CONFLICT: "La solicitud no coincide con el cambio registrado. Consulta el estado del partido.",
};
export function MatchTransitionControls({ id, version, status, canRecordMatch, canSchedule = false, canCancel = false }: { id: string; version: number; status: string; canRecordMatch: boolean; canSchedule?: boolean; canCancel?: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Action | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pendingInput, setPendingInput] = useState<TransitionInput | null>(null);
  const sending = useRef(false);
  const [pending, startTransition] = useTransition();
  const actions = availableMatchActions(status, { canSchedule, canCancel, canRecordMatch });

  useEffect(() => {
    if (!uncertain) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uncertain]);

  function open(action: Action) {
    setSelected(action); setReason(""); setConfirmed(false); setMessage("");
    setUncertain(false); setPendingInput(null); setDialogOpen(true);
  }
  function send(input: TransitionInput) {
    if (sending.current) return;
    sending.current = true;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await transitionMatchAction(input);
        if (result.ok) {
          setDialogOpen(false); setSelected(null); setPendingInput(null); setUncertain(false);
          setMessage("Estado actualizado. Consulta el estado vigente del partido.");
          router.refresh();
        } else if (result.code === "UNAVAILABLE") {
          setUncertain(true);
          setMessage("No se confirmó el resultado. Puedes reintentar exactamente la misma solicitud.");
        } else {
          setPendingInput(null); setUncertain(false);
          setMessage(errors[result.code] ?? "No se pudo realizar el cambio. Consulta el estado actualizado.");
        }
      } catch {
        setUncertain(true);
        setMessage("No se confirmó el resultado. Puedes reintentar exactamente la misma solicitud.");
      } finally { sending.current = false; }
    });
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !confirmed || !reason.trim() || pending || uncertain || sending.current) return;
    const input: TransitionInput = { matchId: id, expectedVersion: version, operationId: crypto.randomUUID(),
      toStatus: selected.toStatus, reason: reason.trim() };
    setPendingInput(input);
    send(input);
  }
  function close() {
    setDialogOpen(false);
    if (!uncertain) { setSelected(null); setPendingInput(null); }
  }
  return <div className="space-y-3"><p>Estado: {labels[status] ?? "Estado no disponible"}</p>{!dialogOpen && <p role="status">{message}</p>}
    {uncertain ? <button type="button" onClick={() => setDialogOpen(true)} className="min-h-12 rounded-xl border border-border px-4 font-semibold">Continuar solicitud pendiente</button>
      : actions.map(action => <button key={action.toStatus} type="button" onClick={() => open(action)} className="mr-2 min-h-12 rounded-xl border border-border px-4 font-semibold text-primary">{action.label}</button>)}
    <FormDialog open={dialogOpen} title={selected?.label ?? "Cambiar estado"} description="Registra el motivo y confirma el cambio." dirty={!!reason || confirmed} pending={pending} uncertain={uncertain} onClose={close}>
      <form onSubmit={submit} className="space-y-4"><p role="status">{message}</p><label className="block">Motivo<textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={pending || uncertain} className="block w-full rounded-xl border border-border bg-surface p-3" /></label>
        <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={pending || uncertain} /> Confirmo este cambio de estado.</label>
        {uncertain && pendingInput ? <><p className="text-sm">La solicitud se conserva mientras esta página permanezca abierta.</p><button type="button" disabled={pending} onClick={() => send(pendingInput)} className="primary-action min-h-12 rounded-xl px-4 font-semibold disabled:opacity-50">{pending ? "Consultando…" : "Reintentar la misma solicitud"}</button></>
          : <button disabled={pending || !confirmed || !reason.trim()} className="primary-action min-h-12 rounded-xl px-4 font-semibold disabled:opacity-50">{pending ? "Guardando…" : "Confirmar"}</button>}
      </form>
    </FormDialog>
  </div>;
}
