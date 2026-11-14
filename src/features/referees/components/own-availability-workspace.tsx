"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SelectField } from "@/components/ui/select-field";
import { availabilityMutation, blockerMessages } from "../contract";
import { intervalLabel } from "../preview-model";
import type { OwnAvailabilityWorkspace } from "../own-availability-contract";
import type { AvailabilityPresentation } from "../types";
import { AvailabilityDialog } from "./availability-dialog";
import { OperationFields } from "./operation-fields";
import { useRefereeOperation } from "./use-referee-operation";

const panel = "rounded-2xl border border-border bg-surface p-5 sm:p-6";
const secondary = "min-h-12 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-primary disabled:opacity-50";
const ownMessages = { ...blockerMessages,
  UNAVAILABLE: "El cambio crearía una indisponibilidad durante un partido aprobado. Comisión debe revisar la designación antes de cambiar ese horario.",
  UNKNOWN_AVAILABILITY: "El cambio dejaría sin cobertura un partido aprobado. Comisión debe revisar la designación antes de cambiar ese horario.",
};
export function OwnAvailabilityWorkspaceView({ workspace: w }: { workspace: OwnAvailabilityWorkspace }) {
  const router = useRouter();
  const [editor, setEditor] = useState<{ interval?: AvailabilityPresentation } | null>(null), [notice, setNotice] = useState("");
  const operation = useRefereeOperation({ actorId: w.actorId, endpoint: "/api/referee-availability", storageNamespace: "referee-own-availability",
    schema: availabilityMutation, base: { leagueId: w.leagueId, seasonId: w.seasonId }, messages: ownMessages,
    onRecovered: () => { setEditor(null); setNotice("Intervalo confirmado al consultar el acuse. No se duplicó la operación."); } });
  const selected = w.contexts.find(c => c.leagueId === w.leagueId && c.seasonId === w.seasonId);
  const close = () => { setEditor(null); if (!operation.hasOperation) operation.onReasonChange(""); };
  return <section className="mx-auto max-w-4xl space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-muted">Arbitraje / Mi disponibilidad</p><h1 className="mt-2 text-3xl font-semibold text-primary">Mi disponibilidad</h1><p className="mt-2 text-sm leading-6 text-muted">Indica cuándo puedes arbitrar y cuándo no. Comisión consultará estos horarios para revisar las designaciones.</p></div>
    <aside className={`${panel} space-y-2 text-sm leading-6`}><p>Tus intervalos son globales: se aplican a todas las ligas donde estés incorporado. El contexto elegido determina la zona horaria de las fechas.</p><p className="text-muted">Una disponibilidad no asigna partidos. Si un cambio afecta una designación aprobada, debe revisarlo Comisión; el cambio se bloquea y la designación se conserva.</p></aside>
    {!w.referee || !w.contexts.length ? <p role="status" className={panel}>Todavía no tienes una incorporación vigente al padrón disponible con tus permisos. Solicita a Comisión que revise tu Persona y tu acceso arbitral.</p> : <>
      <div className={panel}><label htmlFor="own-availability-context" className="mb-2 block text-sm font-semibold">Liga y temporada</label><SelectField id="own-availability-context" value={selected ? `${selected.leagueId}:${selected.seasonId}` : ""} disabled={operation.pending || operation.uncertain} placeholder="Selecciona una liga y temporada" options={w.contexts.map(c => ({ value: `${c.leagueId}:${c.seasonId}`, label: `${c.league} · ${c.season}`, description: c.club }))} onValueChange={value => {
        if (operation.hasOperation) return;
        const c = w.contexts.find(c => `${c.leagueId}:${c.seasonId}` === value);
        if (c) router.push(`/referees/my-availability?league=${c.leagueId}&season=${c.seasonId}`);
      }}/></div>
      {w.blockedCode && <p role="alert" className="rounded-xl border border-danger bg-danger-surface p-4 text-sm text-danger">{blockerMessages[w.blockedCode]}</p>}
      {!selected ? <p role="status" className={panel}>Selecciona el contexto para consultar tus intervalos con fechas en la zona de la liga.</p> : <>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Mis intervalos</h2><p className="mt-2 text-sm text-muted">Fechas en {selected.timezone} · Presentado por {selected.club}</p></div><button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50" disabled={!w.canUpdate || operation.pending || operation.uncertain} onClick={() => setEditor({})}>Añadir intervalo</button></div>
        {!w.intervals.length ? <p role="status" className={panel}>Aún no has registrado intervalos. No se presume disponibilidad: añade los horarios que puedes cubrir y tus indisponibilidades.</p> : <div className="space-y-3">{w.intervals.map(interval => <article key={interval.id} className={`${panel} flex flex-wrap items-center justify-between gap-4`}>
          <div><h3 className="font-semibold">{intervalLabel(interval.startsAt, interval.endsAt, selected.timezone)}</h3><p className={`mt-2 text-sm ${interval.available ? "text-positive" : "text-muted"}`}>{interval.available ? "Disponible" : "Indisponible"}</p></div>
          <button type="button" className={secondary} disabled={!w.canUpdate || operation.pending || operation.uncertain} onClick={() => setEditor({ interval })} aria-label={`Editar intervalo: ${intervalLabel(interval.startsAt, interval.endsAt, selected.timezone)}`}>Editar intervalo</button>
        </article>)}</div>}
      </>}
    </>}
    {notice && <p role="status" className="rounded-xl border border-positive bg-positive-surface p-4 text-sm text-positive">{notice}</p>}
    {(operation.error || operation.uncertain) && !editor && <div className={panel}><OperationFields live={operation}/></div>}
    {editor && selected && w.referee && <AvailabilityDialog referee={{ ...w.referee, name: "Mi disponibilidad" }} interval={editor.interval} timezone={selected.timezone} live={{ ...operation, async mutate(command) { if (await operation.mutate(command)) { setNotice("Intervalo confirmado por el servidor."); return true; } return false; } }} onClose={close}/>}
  </section>;
}
