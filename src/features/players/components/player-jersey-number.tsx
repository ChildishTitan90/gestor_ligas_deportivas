"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { jerseyNumberFromField, updateJerseyNumberSchema } from "../schemas";
import { playerRequest, PlayerRequestError } from "../player-client";
import { playerErrorMessages } from "../player-feedback";
import { z } from "zod";

export function PlayerJerseyNumber({ actorId, registrationId, initial, fetcher = fetch }: {
  actorId: string; registrationId: string; initial: { jerseyNumber: number | null; canAssign: boolean }; fetcher?: typeof fetch;
}) {
  const id = useId();
  const router = useRouter();
  const lock = useRef(false);
  const pending = useRef<{ jerseyNumber: number } | null>(null);
  const [number, setNumber] = useState(initial.jerseyNumber);
  const [phase, setPhase] = useState<"editing" | "sending" | "uncertain">("editing");
  const [message, setMessage] = useState("");
  async function send() {
    if (lock.current || !pending.current) return;
    lock.current = true; setPhase("sending"); setMessage("");
    try {
      const result = z.object({ registrationId: z.literal(registrationId), jerseyNumber: z.literal(pending.current.jerseyNumber) })
        .safeParse(await playerRequest(actorId, `/api/player-registrations/${registrationId}/jersey-number`, pending.current, fetcher));
      if (!result.success) throw new PlayerRequestError("UNCONFIRMED", true);
      setNumber(result.data.jerseyNumber); pending.current = null; setPhase("editing");
      setMessage("Dorsal asignado para esta temporada."); router.refresh();
    } catch (error) {
      if (error instanceof PlayerRequestError && !error.uncertain) {
        setPhase("editing"); pending.current = null;
        setMessage(playerErrorMessages[error.code] ?? "No se pudo asignar el dorsal.");
        if (error.code === "JERSEY_NUMBER_LOCKED") router.refresh();
      } else {
        setPhase("uncertain"); setMessage("No se confirmó el resultado. Puedes reintentar el mismo dorsal de forma segura.");
      }
    } finally { lock.current = false; }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || phase !== "editing") return;
    const result = updateJerseyNumberSchema.safeParse({ jerseyNumber: jerseyNumberFromField(new FormData(event.currentTarget).get("jerseyNumber")) });
    if (!result.success) { setMessage("Escribe un dorsal entero no negativo."); return; }
    pending.current = result.data; await send();
  }
  const editable = initial.canAssign && number === null;
  return <section aria-label="Dorsal habitual" className="space-y-3 rounded-xl border border-border bg-surface p-5">
    <h2 className="text-lg font-semibold text-primary">Dorsal habitual</h2>
    <p>{number ?? "Sin asignar"}</p>
    <p className="text-sm text-muted">Una vez elegido queda fijo durante esta temporada. Al inscribir al jugador en otra temporada podrá elegir otro número.</p>
    {editable && <form onSubmit={submit} className="space-y-3">
      <label htmlFor={id} className="block text-sm font-medium">Dorsal del jugador</label>
      <input id={id} name="jerseyNumber" type="number" min={0} step={1} required disabled={phase !== "editing"}
        className="min-h-12 w-full rounded-xl border border-border bg-surface px-4 py-3 text-foreground disabled:opacity-60" />
      <p className="text-sm text-muted">Confirma el número antes de asignarlo: no podrás cambiarlo ni quitarlo en esta temporada.</p>
      {phase !== "uncertain" && <button disabled={phase === "sending"} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-60">{phase === "sending" ? "Asignando…" : "Asignar dorsal definitivo"}</button>}
      {phase === "uncertain" && <button type="button" onClick={() => void send()} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold">Reintentar el mismo dorsal</button>}
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
