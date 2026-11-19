"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { actionButton, fieldClass, sendSchedulingRequest } from "./scheduling-request";

type Operation = "submit" | "approve" | "return";

const labels = { submit: "Enviar a revisión", approve: "Aprobar propuesta", return: "Devolver a borrador" };
const notices = { submit: "Propuesta enviada a revisión.", approve: "Propuesta aprobada para operación.", return: "Propuesta devuelta a borrador." };

export function ProposalReview({ actorId, proposalId, version, operations, matches }: {
  actorId: string; proposalId: string; version: number; operations: Operation[];
  matches: Record<string, string>;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const confirmed = useRef(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operation || busy.current || confirmed.current) return;
    if (reason.trim().length < 8) {
      setMessage("Escribe un motivo de al menos 8 caracteres.");
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      const outcome = await sendSchedulingRequest("/api/scheduling/review", actorId,
        { proposalId, expectedVersion: version, operation, reason: reason.trim() }, "PROPOSAL_UPDATED");
      if (outcome.error) {
        const match = outcome.matchId && matches[outcome.matchId];
        setMessage(match ? `Partido ${match}. ${outcome.error}` : outcome.error);
        return;
      }
      confirmed.current = true;
      setUncertain(false);
      setOpen(false);
      setNotice(notices[operation]);
      router.refresh();
    } catch {
      setUncertain(true);
      setMessage("No se confirmó la operación. Actualiza la propuesta para comprobar el resultado o reintenta la misma acción.");
    } finally {
      setPending(false);
      busy.current = false;
    }
  }

  return <div className="mt-4">
    {notice ? <p role="status" className="text-sm">{notice}</p>
      : <div className="flex flex-wrap gap-2">
        {(uncertain && operation ? [operation] : operations).map(action => <button key={action} type="button"
          className={action === "return" ? "min-h-12 rounded-xl border border-border px-4 py-2 text-sm font-semibold" : actionButton}
          onClick={() => {
            if (!uncertain) { setReason(""); setMessage(""); }
            setOperation(action);
            setOpen(true);
          }}>{uncertain ? `Recuperar acción · ${labels[action]}` : labels[action]}</button>)}
      </div>}
    {open && operation && <FormDialog open title={labels[operation]} description={
      operation === "approve" ? "La aprobación es operativa. La publicación se realiza por separado."
        : "El motivo quedará registrado en el historial de la propuesta."
    } pending={pending} dirty={Boolean(reason)} uncertain={uncertain} onClose={() => setOpen(false)}>
      <form className="space-y-3" onSubmit={submit}>
        <label className="block text-sm">Motivo
          <textarea autoComplete="off" className={fieldClass} required minLength={8} maxLength={500}
            value={reason} disabled={pending || uncertain} onChange={event => setReason(event.target.value)} />
        </label>
        {message && <p role="alert" className="text-sm">{message}</p>}
        <button type="submit" className={actionButton} disabled={pending}>
          {pending ? "Guardando…" : uncertain ? "Reintentar acción" : labels[operation]}
        </button>
        {message && <button type="button" className="block text-sm underline" disabled={pending}
          onClick={() => router.refresh()}>Actualizar propuesta</button>}
      </form>
    </FormDialog>}
  </div>;
}
