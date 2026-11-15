import { ArrowDownUp, CircleDot, Flag, Pencil, ShieldAlert, Trash2 } from "lucide-react";
import type { MatchReportPresentation, ReportDemoData } from "../types";

export function ReportEvents({ data, report, locked, changesOnly = false, onEdit, onRemove }: {
  data: ReportDemoData; report: MatchReportPresentation; locked: boolean; changesOnly?: boolean;
  onEdit?: (id: string) => void; onRemove?: (id: string) => void;
}) {
  const events = report.events.filter(event => !changesOnly || event.typeCode === "SUBSTITUTION");
  return <>{!events.length ? <p className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-muted">{changesOnly ? "No hay cambios registrados." : "Todavía no hay eventos. Agrega lo ocurrido durante el partido."}</p> : <ol className="space-y-3">{events.map(event => {
    const type = data.eventTypes.find(type => type.code === event.typeCode);
    const Icon = event.typeCode === "GOAL" ? CircleDot : event.typeCode === "SUBSTITUTION" ? ArrowDownUp : type?.opensCase ? ShieldAlert : Flag;
    const player = data.players.find(player => player.id === event.playerId);
    return <li key={event.id} className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-soft text-primary"><Icon size={20} aria-hidden="true" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-primary">{type?.label ?? event.typeCode}</h3><span className="text-xs text-muted">{event.periodNumber === null ? "Periodo sin indicar" : `P${event.periodNumber}`} · {event.minute === null ? "Sin minuto" : `${event.minute}′`}</span></div><p className="mt-1 text-sm">{event.teamId === data.match.home.id ? data.match.home.name : event.teamId === data.match.away.id ? data.match.away.name : "Sin equipo indicado"}</p><p className="mt-1 text-sm text-muted">{event.typeCode === "SUBSTITUTION" ? `Entra ${player?.name ?? "sin indicar"} · Sale ${data.players.find(player => player.id === event.outgoingPlayerId)?.name ?? "sin indicar"}` : player?.name ?? "Sin jugador indicado"}</p>{event.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{event.description}</p>}{type?.opensCase && <p className="mt-2 text-xs font-semibold text-danger">Requiere revisión disciplinaria · Sin sanción automática</p>}
      {!locked && <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm" onClick={() => onEdit?.(event.id)} aria-label={`Editar ${type?.label}`}><Pencil size={15} aria-hidden="true" /> Editar</button><button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm text-danger" onClick={() => onRemove?.(event.id)} aria-label={`Quitar ${type?.label}`}><Trash2 size={15} aria-hidden="true" /> Quitar</button></div>}
    </div></li>;
  })}</ol>}</>;
}
