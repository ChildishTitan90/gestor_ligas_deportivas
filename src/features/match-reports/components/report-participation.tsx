import { ArrowDownUp, Clock3, Pencil, Plus, Trash2 } from "lucide-react";
import type { MatchReportPresentation, ReportDemoData } from "../types";
import { participationPeriods } from "../tactics";
import { ReportEvents } from "./report-events";
import { ReportNotice, secondaryButton, SectionHeading } from "./report-shared";

export function ReportParticipation({ data, report, locked, onPeriod, onRemovePeriod, onChange, onEditEvent, onRemoveEvent, onMoveEvent }: {
  data: ReportDemoData; report: MatchReportPresentation; live?: boolean; locked: boolean;
  onPeriod: (playerId: string, index: number | null) => void;
  onRemovePeriod: (playerId: string, index: number) => void;
  onChange: () => void;
  onEditEvent: (id: string) => void;
  onRemoveEvent: (id: string) => void;
  onMoveEvent?: (id: string, direction: -1 | 1) => void;
}) {
  const selected = report.lineups.filter(row => row.selected);
  return <section aria-label="Participación y cambios">
    <SectionHeading number="02" title="Tiempos y cambios">Registra entrada y salida por periodo; conserva como pendientes los minutos que no conoces.</SectionHeading>
    <ReportNotice>Los cambios y expulsiones con periodo y minuto actualizan los tiempos de participación. Los datos desconocidos siguen pendientes; no se calculan duraciones, descansos ni reglas de reingreso.</ReportNotice>
    <div className="my-5 flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold text-primary"><Clock3 size={19} aria-hidden="true" /> Participación por jugador</h3><button type="button" className={secondaryButton} disabled={locked || !selected.length} onClick={() => onPeriod("", null)}><Plus size={18} aria-hidden="true" /> Registrar tiempo</button></div>
    {!selected.length && <p className="rounded-2xl border border-dashed border-border p-7 text-center text-muted">Primero selecciona jugadores en Alineaciones.</p>}
    <div className="grid items-start gap-5 xl:grid-cols-2">{[data.match.home, data.match.away].map(team => <article key={team.id} className="min-w-0 rounded-2xl border border-border bg-surface"><h3 className="border-b border-border p-4 font-semibold text-primary">{team.name}</h3><ul className="divide-y divide-border">{selected.filter(row => data.players.some(player => player.id === row.playerId && player.teamId === team.id)).map(row => <li key={row.playerId} className="p-4"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">#{row.matchJersey ?? "–"} · {data.players.find(player => player.id === row.playerId)?.name}</p><button type="button" disabled={locked} className="grid size-12 shrink-0 place-items-center rounded-xl border border-border text-primary disabled:opacity-50" aria-label={`Agregar tiempo de ${data.players.find(player => player.id === row.playerId)?.name}`} onClick={() => onPeriod(row.playerId, null)}><Plus size={18} aria-hidden="true" /></button></div>
      {!participationPeriods(row, report.events).length && <p className="mt-2 text-sm text-muted">Sin tiempos registrados.</p>}
      {participationPeriods(row, report.events).map((period, index) => <div key={index} className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-background p-3"><div className="text-sm"><p className="font-medium">Periodo {period.periodNumber}</p><p className="mt-1 text-muted">Entra {period.entryMinute ?? "pendiente"} · Sale {period.exitMinute ?? "pendiente"}{period.entryMinute !== null || period.exitMinute !== null ? " min" : ""}</p>{report.events.some(e => e.periodNumber === period.periodNumber && e.minute !== null && ["SUBSTITUTION", "SENDING_OFF"].includes(e.typeCode) && (e.playerId === row.playerId || e.outgoingPlayerId === row.playerId)) && <p className="mt-1 text-xs text-muted">Incluye tiempos de eventos; edítalos en el cambio o la expulsión.</p>}</div><div className="flex shrink-0 gap-1"><button type="button" className="grid size-11 place-items-center rounded-lg border border-border disabled:opacity-50" disabled={locked} onClick={() => onPeriod(row.playerId, row.periods.findIndex(p => p.periodNumber === period.periodNumber) < 0 ? null : row.periods.findIndex(p => p.periodNumber === period.periodNumber))} aria-label={`Editar periodo ${period.periodNumber} de ${row.playerId}`}><Pencil size={16} aria-hidden="true" /></button><button type="button" className="grid size-11 place-items-center rounded-lg border border-border text-danger disabled:opacity-50" disabled={locked || !row.periods.some(p => p.periodNumber === period.periodNumber)} onClick={() => onRemovePeriod(row.playerId, row.periods.findIndex(p => p.periodNumber === period.periodNumber))} aria-label={`Quitar periodo ${period.periodNumber} de ${row.playerId}`}><Trash2 size={16} aria-hidden="true" /></button></div></div>)}
    </li>)}</ul></article>)}</div>
    <div className="mt-7"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-lg font-semibold text-primary"><ArrowDownUp size={20} aria-hidden="true" /> Cambios de jugadores</h3><button type="button" className={secondaryButton} disabled={locked || !selected.length} onClick={onChange}>Registrar cambio</button></div><ReportEvents data={data} report={report} locked={locked} changesOnly onEdit={onEditEvent} onRemove={onRemoveEvent} onMove={onMoveEvent} /></div>
  </section>;
}
