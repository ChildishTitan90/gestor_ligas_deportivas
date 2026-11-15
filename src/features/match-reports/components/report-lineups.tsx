import { Check, ShieldAlert, Shirt } from "lucide-react";
import { SelectField } from "@/components/ui/select-field";
import type { MatchReportPresentation, ReportDemoData, ReportLineup } from "../types";
import { inputClass, ReportNotice, SectionHeading } from "./report-shared";

export function ReportLineups({ data, report, locked, onLineup, onCaptain }: {
  data: ReportDemoData; report: MatchReportPresentation; locked: boolean;
  onLineup: (playerId: string, changes: Partial<ReportLineup>) => void;
  onCaptain: (teamId: string, playerId: string) => void;
}) {
  return <section aria-label="Alineaciones">
    <SectionHeading number="01" title="Quiénes participan">Elige la alineación y el capitán de cada equipo. El dorsal de este partido se conserva por separado del habitual.</SectionHeading>
    <div className="mb-5"><ReportNotice>Los jugadores bloqueados siguen visibles con su motivo y no pueden incorporarse. La elegibilidad mostrada es sintética; el servidor deberá volver a comprobarla en la entrega funcional.</ReportNotice></div>
    <div className="grid items-start gap-5 xl:grid-cols-2">{[data.match.home, data.match.away].map(team => {
      const players = data.players.filter(player => player.teamId === team.id);
      const selected = players.filter(player => report.lineups.some(row => row.playerId === player.id && row.selected));
      return <article key={team.id} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface">
        <header className="border-b border-border bg-soft p-5"><p className="text-xs text-muted">{team.id === data.match.home.id ? "Local" : "Visitante"}</p><h3 className="mt-1 text-lg font-semibold text-primary">{team.name}</h3><p className="mt-1 text-sm text-muted">{selected.length} convocados · {players.filter(p => !p.eligible).length} bloqueados</p></header>
        <div className="border-b border-border p-4"><label htmlFor={`captain-${team.id}`} className="mb-2 block text-sm font-semibold">Capitán de {team.shortName}</label><SelectField id={`captain-${team.id}`} name={`captain-${team.id}`} value={report.captains[team.id] ?? ""} onValueChange={value => onCaptain(team.id, value)} disabled={locked} placeholder="Selecciona al capitán" options={selected.map(player => ({ value: player.id, label: player.name, description: `Dorsal del partido: ${report.lineups.find(row => row.playerId === player.id)?.matchJersey ?? "pendiente"}` }))} /></div>
        <ul className="divide-y divide-border">{players.map(player => {
          const row = report.lineups.find(item => item.playerId === player.id)!;
          return <li key={player.id} className="p-4">
            <div className="flex items-start gap-3"><label className="flex min-h-12 min-w-0 flex-1 items-center gap-3"><input type="checkbox" checked={row.selected} disabled={locked || !player.eligible} onChange={event => onLineup(player.id, { selected: event.target.checked })} className="size-5 shrink-0 accent-[var(--action)]" /><span className="min-w-0"><span className="block font-semibold">{player.name}{report.captains[team.id] === player.id && <span className="ml-2 inline-block rounded border border-accent px-1.5 text-xs" aria-label="Capitán">C</span>}</span><span className="mt-1 flex items-center gap-1 text-xs text-muted">{player.eligible ? <Check size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}{player.eligible ? "Elegible · Ejemplo" : "Bloqueado para alinear"}</span></span></label><span className="flex items-center gap-1 pt-2 text-xs text-muted" title="Dorsal habitual"><Shirt size={14} aria-hidden="true" />{player.usualJersey ?? "–"}<span className="sr-only"> habitual</span></span></div>
            {player.blockers.length > 0 && <ul className="mt-2 space-y-1 text-sm text-danger">{player.blockers.map(blocker => <li key={blocker.code}>{blocker.message}</li>)}</ul>}
            {row.selected && <div className="mt-3 grid grid-cols-[minmax(0,1fr)_6rem] items-end gap-3">
              <div><label className="mb-2 block text-xs font-medium" htmlFor={`role-${player.id}`}>Participación de {player.name}</label><SelectField id={`role-${player.id}`} value={row.starter ? "starter" : "substitute"} onValueChange={value => onLineup(player.id, { starter: value === "starter" })} disabled={locked} searchable={false} options={[{ value: "starter", label: "Titular" }, { value: "substitute", label: "Suplente" }]} /></div>
              <label className="text-xs font-medium" htmlFor={`jersey-${player.id}`}>Dorsal del partido<input id={`jersey-${player.id}`} type="number" min="0" step="1" value={row.matchJersey ?? ""} disabled={locked} aria-label={`Dorsal del partido de ${player.name}`} onChange={event => onLineup(player.id, { matchJersey: event.target.value === "" ? null : Number(event.target.value) })} className={inputClass} /></label>
            </div>}
          </li>;
        })}</ul>
      </article>;
    })}</div>
  </section>;
}
