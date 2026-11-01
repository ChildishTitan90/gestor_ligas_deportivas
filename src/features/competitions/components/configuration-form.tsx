"use client";
import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";

const conflicts: Record<string, string> = {
  STALE_CONFIGURATION: "Otra persona modificó la temporada. Consulta la versión actual antes de continuar.",
  SEASON_DATES_IN_USE: "No se pueden cambiar las fechas: la temporada ya tiene categorías o actividad relacionada.",
  GROUP_IN_USE: "El grupo tiene equipos, partidos o clasificaciones relacionados y no puede modificarse ni eliminarse.",
  GROUP_ALREADY_EXISTS: "Ya existe un grupo con ese nombre en esta categoría.",
  CATEGORY_ALREADY_EXISTS: "La categoría ya existe o ya está asociada a esta temporada.",
  SEASON_IN_USE: "La temporada tiene datos relacionados. Solo se puede eliminar una temporada vacía.",
  CATEGORY_IN_USE: "La categoría tiene datos relacionados. Conserva su configuración e historial.",
  CATEGORY_ELIGIBILITY_CONFIGURED: "Esta categoría ya tiene reglas de jugadores. No se puede cambiar su tipo o reglamento desde esta operación.",
  PLAYER_POLICY_IN_USE: "Ya hay jugadores registrados con estas reglas; no se pueden sustituir.",
  UNRESOLVED_MATCHES: "Hay partidos sin resultado definitivo. El capturista debe completarlos antes del cierre.",
  SEASON_NOT_ACTIVE: "Solo se puede cerrar una temporada activa.",
  SEASON_CLOSED: "La temporada está cerrada y solo permite consulta.",
  COMPETITION_ALREADY_STARTED: "La competencia ya inició; esta configuración no puede modificarse.",
  DISTRIBUTION_REQUIRES_GROUPS: "Crea al menos un grupo antes de distribuir los equipos.",
  CATEGORY_NOT_AUTHORIZED: "Hay inscripciones cuya categoría ya no está autorizada. Revisa las afiliaciones antes de distribuir.",
};

export function ConfigurationForm({ title, endpoint, method = "POST", version, fixed = {}, numbers = [], modal = false, successHref, children }: {
  title: string; endpoint: string; method?: string; version: number;
  fixed?: Record<string, string>; numbers?: string[]; modal?: boolean; successHref?: string; children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const guard = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const form = <form ref={formRef} className="space-y-4" onChange={() => setDirty(true)} onSubmit={async event => {
    event.preventDefault();
    if (guard.current || locked) return;
    guard.current = true; setPending(true); setMessage("");
    const formData = new FormData(event.currentTarget);
    const fields = Object.fromEntries(formData);
    const payload: Record<string, unknown> = { ...fields, ...fixed, expectedSeasonVersion: version };
    for (const key of numbers) payload[key] = Number(payload[key]);
    if (endpoint === "/api/competitions/categories") delete payload.expectedSeasonVersion;
    if (endpoint.endsWith("/player-policy")) {
      const nullable = (key: string) => fields[key] === "" ? null : Number(fields[key]);
      payload.policy = { referenceYear: Number(fields.referenceYear), minimumAge: Number(fields.minimumAge),
        maximumAge: nullable("maximumAge"), exceptionMinimumAge: nullable("exceptionMinimumAge"),
        documents: formData.getAll("documents"), registrationDays: formData.getAll("registrationDays").map(Number),
        timezone: fields.timezone, playersOnField: Number(fields.playersOnField),
        maximumCalledUp: nullable("maximumCalledUp"), maximumRoster: nullable("maximumRoster") };
      for (const key of Object.keys(fields)) if (key !== "reason") delete payload[key];
    }
    if ("announcement" in payload) {
      payload.points = { win: Number(fields.win), draw: Number(fields.draw), loss: Number(fields.loss) };
      payload.calendar = { rounds: Number(fields.rounds), matchDurationMinutes: Number(fields.matchDurationMinutes) };
      payload.tieBreakers = String(fields.tieBreakers).split(",").map(value => value.trim());
      for (const key of ["win", "draw", "loss", "rounds", "matchDurationMinutes", "tieBreakers"]) if (key !== "tieBreakers") delete payload[key];
    }
    try {
      const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (response.status >= 500) throw new Error("uncertain");
      const result: unknown = await response.json();
      if (!result || typeof result !== "object") throw new Error("uncertain");
      if (!response.ok) {
        const code = "code" in result && typeof result.code === "string" ? result.code : "";
        const catalogDuplicate = endpoint === "/api/competitions/categories" && code === "CATEGORY_ALREADY_EXISTS";
        setMessage(catalogDuplicate ? "Ese nombre ya existe en el catálogo. Usa la categoría existente en ‘Asociar categoría a la temporada’, o escribe otro nombre para crear una distinta." : response.status === 401 ? "Tu sesión terminó. Vuelve a iniciar sesión." : response.status === 403 ? "Ya no tienes permiso para esta operación." : conflicts[code] ?? (response.status === 409 ? "La configuración cambió o tiene datos relacionados. Consulta el estado actualizado antes de continuar." : "Revisa los campos y el contexto de la operación."));
        setLocked(!catalogDuplicate && [401, 403, 409].includes(response.status));
      } else {
        if (!("id" in result && typeof result.id === "string") && !("assignments" in result && Array.isArray(result.assignments) && "seasonVersion" in result && typeof result.seasonVersion === "number")) throw new Error("uncertain");
        setMessage("assignments" in result && Array.isArray(result.assignments) ? `Distribución confirmada: ${result.assignments.length} equipos asignados. Consulta la configuración actualizada.` : "Cambio confirmado. Consulta la configuración actualizada para continuar.");
        setDirty(false); setLocked(true); if (successHref) router.replace(successHref); else router.refresh();
      }
    } catch { setMessage("No se pudo confirmar el resultado. Consulta la configuración antes de volver a capturar; el cambio podría haberse guardado."); setUncertain(true); setLocked(true); }
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
  return modal ? <><button className="min-h-12 rounded-xl border border-border px-4" onClick={() => setOpen(true)}>{title}</button><FormDialog open={open} title={title} description="El cambio requiere permisos vigentes y queda registrado con su motivo." dirty={dirty} pending={pending} uncertain={uncertain} onClose={reason => { setOpen(false); if (reason === "discard") { formRef.current?.reset(); setDirty(false); } }}>{form}</FormDialog></> : <section className="rounded-2xl border border-border bg-surface p-5"><h3 className="mb-4 text-lg font-semibold">{title}</h3>{form}</section>;
}
