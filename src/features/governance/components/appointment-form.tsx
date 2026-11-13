"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import { submitAppointment } from "../actions";
import { readAppointment, sendAppointment, type AppointmentRequest } from "../appointment-recovery";
import { governanceMutation } from "../contract";

export function AppointmentForm({ actorId, leagueId, children }: {
  actorId: string; leagueId: string; children?: ReactNode;
}) {
  const router = useRouter();
  const key = `pdgld37:appointment:${actorId}:${leagueId}`;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AppointmentRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const sending = useRef(false);

  function show() {
    setConfirmed(false);
    setMessage("");
    try {
      setPending(readAppointment(sessionStorage, key));
      setOpen(true);
    } catch {
      setMessage("No se puede leer la captura guardada en esta pestaña. Se conservó el registro local.");
    }
  }

  async function send(request: AppointmentRequest, retry: boolean) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await sendAppointment(sessionStorage, key, request, saved => {
        setPending(saved);
        return submitAppointment(saved);
      });
      if (result.status === "saved") {
        sessionStorage.removeItem(key);
        setPending(null);
        setOpen(false);
        setConfirmed(true);
        router.refresh();
      } else if (result.status === "rejected" && !retry) {
        sessionStorage.removeItem(key);
        setPending(null);
        setMessage("El servidor rechazó la solicitud. Revisa los datos y los permisos.");
      } else {
        setMessage("Aún no se pudo confirmar el guardado. Conservamos la captura para reintentar el mismo envío.");
      }
    } catch {
      setMessage("No se pudo completar la confirmación. Revisa la captura antes de volver a enviar.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = governanceMutation.safeParse({
      ...Object.fromEntries(new FormData(event.currentTarget)),
      operation: "appoint", leagueId, requestId: crypto.randomUUID(),
    });
    if (!result.success || result.data.operation !== "appoint") {
      setMessage("Revisa la persona, el cargo, el motivo y el orden de las fechas.");
      return;
    }
    void send(result.data, false);
  }

  return <>
    <button type="button" onClick={show} className="min-h-11 rounded-xl border border-border px-4 py-2 font-semibold">
      {children ? "Registrar nombramiento" : "Recuperar nombramiento pendiente"}
    </button>
    {confirmed && <p role="status">Nombramiento confirmado en el historial.</p>}
    {!open && message && <p role="alert">{message}</p>}
    {open && <FormDialog open title="Nombramiento" description="Registra un periodo o recupera una solicitud pendiente de esta pestaña."
      pending={busy} uncertain={!!pending} onClose={() => { setOpen(false); setMessage(""); }}>
      {message && <p role="alert" className="mb-3">{message}</p>}
      {pending ? <div className="space-y-3">
        <p>La confirmación está pendiente. Puedes reintentar con los mismos datos.</p>
        <p>Vigencia {pending.startsAt} · {pending.endsAt || "Sin fecha final"}</p>
        <p>Motivo: {pending.reason}</p>
        <button type="button" disabled={busy} onClick={() => void send(pending, true)}
          className="primary-action min-h-11 rounded-xl px-4 py-2">Reintentar la misma solicitud</button>
      </div> : children ? <form onSubmit={capture} className="space-y-4">
        {children}
        <label className="block">Motivo del cambio
          <input name="reason" required minLength={3} maxLength={300}
            className="block min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2" />
        </label>
        <button type="submit" disabled={busy} className="primary-action min-h-11 rounded-xl px-4 py-2">Guardar nombramiento</button>
      </form> : <p role="status">Esta pestaña no tiene solicitudes pendientes para la liga.</p>}
    </FormDialog>}
  </>;
}