"use client";
import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";

export function ConfigurationForm({ title, endpoint, method = "POST", version, fixed = {}, numbers = [], modal = false, children }: {
  title: string; endpoint: string; method?: string; version: number;
  fixed?: Record<string, string>; numbers?: string[]; modal?: boolean; children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");
  const guard = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const form = <form ref={formRef} className="space-y-4" onChange={() => setDirty(true)} onSubmit={async event => {
    event.preventDefault();
    if (guard.current || locked) return;
    guard.current = true; setPending(true); setMessage("");
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const payload: Record<string, unknown> = { ...fields, ...fixed, expectedSeasonVersion: version };
    for (const key of numbers) payload[key] = Number(payload[key]);
    if (endpoint === "/api/competitions/categories") delete payload.expectedSeasonVersion;
    if ("announcement" in payload) {
      payload.points = { win: Number(fields.win), draw: Number(fields.draw), loss: Number(fields.loss) };
      payload.calendar = { rounds: Number(fields.rounds), matchDurationMinutes: Number(fields.matchDurationMinutes) };
      payload.tieBreakers = String(fields.tieBreakers).split(",").map(value => value.trim());
      for (const key of ["win", "draw", "loss", "rounds", "matchDurationMinutes", "tieBreakers"]) if (key !== "tieBreakers") delete payload[key];
    }
    try {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (response.status >= 500) throw new Error("uncertain");
      if (!response.ok) {
        setMessage(response.status === 401 ? "Tu sesión terminó. Vuelve a iniciar sesión." : response.status === 403 ? "Ya no tienes permiso para esta operación." : response.status === 409 ? "La configuración cambió o tiene datos relacionados. Consulta el estado actualizado antes de continuar." : "Revisa los campos y el contexto de la operación.");
        setLocked(response.status === 409 || response.status === 403);
      } else {
        setMessage("Cambio confirmado. Consulta la configuración actualizada para continuar.");
        setDirty(false); setLocked(true); router.refresh();
      }
    } catch { setMessage("No se pudo confirmar el resultado. Consulta la configuración antes de volver a capturar; el cambio podría haberse guardado."); setLocked(true); }
    finally { setPending(false); guard.current = false; }
  }}>
    <fieldset disabled={pending || locked} className="space-y-4">
      {children}
      <label className="block">Motivo<textarea name="reason" required maxLength={1000} className="min-h-24 w-full rounded-xl border border-border bg-surface p-3" /></label>
      <button className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold">{pending ? "Guardando…" : title}</button>
    </fieldset>
    {message && <p role="status">{message}</p>}
    {locked && <button type="button" className="min-h-12 underline" onClick={() => window.location.reload()}>Consultar configuración actualizada</button>}
  </form>;
  return modal ? <><button className="min-h-12 rounded-xl border border-border px-4" onClick={() => setOpen(true)}>{title}</button><FormDialog open={open} title={title} description="El cambio requiere permisos vigentes y queda registrado con su motivo." dirty={dirty} pending={pending} uncertain={locked} onClose={reason => { setOpen(false); if (reason === "discard") { formRef.current?.reset(); setDirty(false); } }}>{form}</FormDialog></> : <section className="rounded-2xl border border-border bg-surface p-5"><h3 className="mb-4 text-lg font-semibold">{title}</h3>{form}</section>;
}
