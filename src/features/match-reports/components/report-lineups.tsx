"use client";
import { EventIcon } from "./event-icon";
import { useState } from "react";
import { Check, ShieldAlert, Shirt } from "lucide-react";
import { SelectField } from "@/components/ui/select-field";
import type { MatchReportPresentation, ReportDemoData, ReportLineup } from "../types";
import { inputClass, ReportNotice, SectionHeading } from "./report-shared";
import { ReportTactics, type SlotAssignment } from "./report-tactics";
import { effectiveCaptain } from "../captaincy";
import { jerseyErrors } from "../lineup-rules";
import type { TeamTactics } from "../tactics";

export function ReportLineups({ data, report, live = false, locked, onLineup, onCaptain, onTactics, onPlayer }: {
  data: ReportDemoData; report: MatchReportPresentation; live?: boolean; locked: boolean;
  onLineup: (playerId: string, changes: Partial<ReportLineup>) => void;
  onCaptain: (teamId: string, playerId: string) => void;
  onTactics: (teamId: string, tactics: TeamTactics, assignment?: SlotAssignment) => void;
  onPlayer: (playerId: string) => void;
}) {
  const errors = jerseyErrors(data, report);
  const [activeTeam, setActiveTeam] = useState(data.match.home.id);
  return <section aria-label="Alineaciones">
    <SectionHeading number="01" title="Quiénes participan">Elige la alineación y el capitán de cada equipo. El dorsal de este partido se conserva por separado del habitual.</SectionHeading>
    <div className="mb-5"><ReportNotice>Los jugadores bloqueados siguen visibles con su motivo y no pueden incorporarse. {live ? "El servidor vuelve a comprobar la elegibilidad al guardar." : "La elegibilidad mostrada es sintética; el servidor deberá volver a comprobarla en la entrega funcional."}</ReportNotice></div>
    <div className="mb-5 flex gap-2 xl:hidden" aria-label="Equipo para alinear">{[data.match.home, data.match.away].map((team, index) => <button key={team.id} type="button" aria-pressed={activeTeam === team.id} onClick={() => setActiveTeam(team.id)} className={`min-h-12 min-w-0 flex-1 rounded-xl border px-3 py-3 text-left text-sm font-semibold ${activeTeam === team.id ? "border-accent bg-soft text-primary" : "border-border bg-surface text-muted"}`}><span className="block text-xs">{index ? "Visitante" : "Local"}</span><span className="mt-1 block truncate">{team.shortName}</span></button>)}</div>
    <div className="grid items-start gap-5 xl:grid-cols-2">{[data.match.home, data.match.away].map(team => {
      const players = data.players.filter(player => player.teamId === team.id);
      const selected = players.filter(player => report.lineups.some(row => row.playerId === player.id && row.selected));
      return <article key={team.id} className={`min-w-0 overflow-hidden rounded-2xl border border-border bg-surface ${activeTeam === team.id ? "" : "hidden xl:block"}`}>
        <header className="border-b border-border bg-soft p-5"><p className="text-xs text-muted">{team.id === data.match.home.id ? "Local" : "Visitante"}</p><h3 className="mt-1 text-lg font-semibold text-primary">{team.name}</h3><p className="mt-1 text-sm text-muted">{selected.length} convocados · {players.filter(p => !p.eligible).length} bloqueados</p></header>
        <ReportTactics data={data} report={report} team={team} locked={locked} onTactics={onTactics} onPlayer={onPlayer} />
        {report.lineupsLock && <p className="border-t border-border px-4 py-3 text-sm font-semibold text-primary">Capitán en cancha: {data.players.find(p=>p.id===effectiveCaptain(report.captains[team.id],report.events,team.id))?.name ?? "Pendiente de indicar al registrar la salida"}</p>}
        <div className="border-b border-border p-4"><label htmlFor={`captain-${team.id}`} className="mb-2 block text-sm font-semibold">Capitán inicial de {team.shortName}</label><SelectField id={`captain-${team.id}`} name={`captain-${team.id}`} value={report.captains[team.id] ?? ""} onValueChange={value => onCaptain(team.id, value)} disabled={locked} placeholder="Selecciona al capitán" options={selected.map(player => ({ value: player.id, label: player.name, description: `Dorsal del partido: ${report.lineups.find(row => row.playerId === player.id)?.matchJersey ?? "pendiente"}` }))} /></div>
        <details className="border-t border-border"><summary className="min-h-12 cursor-pointer p-4 font-semibold text-primary">Convocados y dorsales</summary><p className="px-4 pb-4 text-xs leading-5 text-muted">Marca a quienes se presentan al partido. Con dorsal válido se ocupan automáticamente las posiciones libres; después de los once, quedan en banca; los bloqueados no pueden convocarse.</p><ul className="divide-y divide-border">{players.map(player => {
          const row = report.lineups.find(item => item.playerId === player.id)!;
          return <li key={player.id} className="p-4">
            <div className="flex items-start gap-3"><label className="flex min-h-12 min-w-0 flex-1 items-center gap-3"><input type="checkbox" checked={row.selected} disabled={locked || !player.eligible} onChange={event => onLineup(player.id, { selected: event.target.checked })} className="size-5 shrink-0 accent-[var(--action)]" /><span className="min-w-0"><span className="block font-semibold">{player.name}{report.captains[team.id] === player.id && <span className="ml-2 inline-block rounded border border-accent px-1.5 text-xs" aria-label="Capitán">C</span>}</span><span className="mt-1 flex items-center gap-1 text-xs text-muted">{player.eligible ? <Check size={14} aria-hidden="true" /> : player.blockers.some(b=>/SANCTION|SUSPEN/.test(b.code)||b.code==="PARTICIPATION_BLOCKED") ? <EventIcon code="SUSPENDED" size={16}/> : <ShieldAlert size={14} aria-hidden="true" />}{player.halfReservation ? "Reserva por mitad · Pendiente de guardar" : player.eligible ? (live ? "Elegible para el partido" : "Elegible · Ejemplo") : "Bloqueado para alinear"}</span></span></label><span className="flex items-center gap-1 pt-2 text-xs text-muted" title="Dorsal habitual"><Shirt size={14} aria-hidden="true" />{player.usualJersey ?? "–"}<span className="sr-only"> habitual</span></span></div>
            <div className="mt-3"><label htmlFor={`half-${player.id}`} className="mb-2 block text-sm font-medium">Participación prevista de {player.name}</label><SelectField id={`half-${player.id}`} value={String(row.participationHalf ?? "")} disabled={locked} onValueChange={value => onLineup(player.id, { participationHalf: value === "1" ? 1 : value === "2" ? 2 : undefined })} options={[{value:"",label:"Sin reserva por mitad"},{value:"1",label:"Solo primer tiempo"},{value:"2",label:"Solo segundo tiempo · Inicia en banca"}]} /></div>
            {row.participationHalf && <p className="mt-2 text-sm text-muted">Reserva para el {row.participationHalf === 1 ? "primer" : "segundo"} tiempo. No acredita minutos jugados; el servidor comprueba el traslado en el medio tiempo.</p>}
            {player.blockers.length > 0 && <ul className="mt-2 space-y-1 text-sm text-danger">{player.blockers.map(blocker => <li key={blocker.code}>{blocker.message}</li>)}</ul>}
            {row.selected && <div className="mt-3 grid grid-cols-[minmax(0,1fr)_6rem] items-end gap-3">
              <p className="pb-3 text-xs font-medium text-muted">{row.starter ? "Titular inicial · Asignado en el campo" : "Suplente · Sin posición inicial"}</p>
              <label className="text-xs font-medium" htmlFor={`jersey-${player.id}`}>Dorsal del partido<input id={`jersey-${player.id}`} type="number" min="0" step="1" value={row.matchJersey ?? ""} disabled={locked} aria-label={`Dorsal del partido de ${player.name}`} aria-invalid={Boolean(errors[player.id])} aria-describedby={errors[player.id] ? `jersey-error-${player.id}` : undefined} onChange={event => onLineup(player.id, { matchJersey: event.target.value === "" ? null : Number(event.target.value) })} className={`${inputClass} ${errors[player.id] ? "border-danger" : ""}`} />{errors[player.id] && <span id={`jersey-error-${player.id}`} role="alert" className="mt-2 block text-xs leading-5 text-danger">{errors[player.id]}</span>}</label>
            </div>}
          </li>;
        })}</ul></details>
      </article>;
    })}</div>
  </section>;
}
