"use client";
import { effectiveCaptain } from "../captaincy";
import { ArrowDownUp, Bandage, CircleDot, ShieldAlert } from "lucide-react";
import { FormDialog } from "@/components/ui/form-dialog";
import type { MatchReportPresentation, ReportDemoData, ReportPlayer } from "../types";
import { currentPitch, eventTimeLabel, keeperKit, type TeamTactics } from "../tactics";
import { PlayerEventBadges } from "./player-event-badges";
import { PlayerBadge } from "./player-badge";
import { formatClock } from "../match-clock";

const actions = [
  { code: "GOAL", label: "Gol", icon: CircleDot },
  { code: "CAUTION", label: "Amarilla", icon: null },
  { code: "SENDING_OFF", label: "Roja", icon: null },
  { code: "SUBSTITUTION", label: "Cambio", icon: ArrowDownUp },
  { code: "INJURY", label: "Lesión", icon: Bandage },
  { code: "SERIOUS_INCIDENT", label: "Incidente", icon: ShieldAlert },
];
export function PlayerActionsDialog({ player, data, report, tactics, locked, breakOnly = false, onClose, onAction }: { player: ReportPlayer; data: ReportDemoData; report: MatchReportPresentation; tactics: TeamTactics; locked: boolean; breakOnly?: boolean; onClose: () => void; onAction: (code: string) => void }) {
  const row = report.lineups.find(r => r.playerId === player.id);
  const events = report.events.filter(e => e.playerId === player.id || e.outgoingPlayerId === player.id);
  const doubleYellow = report.events.filter(e => e.playerId === player.id && e.teamId === player.teamId && e.typeCode === "CAUTION").length >= 2;
  const removed = currentPitch(tactics.slots, report.events, player.teamId).removed.has(player.id);
  return <FormDialog open title="Acciones del jugador" description="Selecciona una acción y revisa sus datos antes de registrarla." onClose={onClose}>
    <div className="mb-5 flex items-center gap-4 rounded-2xl border border-border bg-soft p-4"><PlayerBadge player={player} jersey={row?.matchJersey} kit={currentPitch(tactics.slots, report.events, player.teamId).slots[0]?.playerId === player.id ? keeperKit(tactics) : tactics.kit} showPhoto /><div className="min-w-0 flex-1"><p className="font-semibold text-primary">#{row?.matchJersey ?? "–"} · {player.name}</p><p className="mt-1 text-sm text-muted">{player.teamId === data.match.home.id ? data.match.home.name : data.match.away.name}{effectiveCaptain(report.captains[player.teamId],report.events,player.teamId) === player.id ? " · Capitán" : ""}</p></div></div>
    <div className="mb-4"><PlayerEventBadges events={report.events.filter(e=>e.playerId===player.id && e.teamId===player.teamId)} /></div>
    {doubleYellow && <p role="status" className="mb-4 rounded-xl border border-danger bg-danger-surface p-3 text-sm text-danger">Roja por segunda amarilla · Expulsado, sin sustitución ni reingreso. Requiere revisión disciplinaria; no se aplica sanción automática.</p>}
    <div className="grid grid-cols-3 gap-2 sm:gap-3">{actions.filter(action => data.eventTypes.some(t => t.code === action.code)).map(({ code, label, icon: Icon }) => <button key={code} type="button" disabled={locked || (breakOnly && code !== "SUBSTITUTION") || (code === "SUBSTITUTION" && removed) || (doubleYellow && code === "CAUTION")} onClick={() => onAction(code)} className="flex min-h-24 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface px-2 py-4 text-sm font-semibold text-primary hover:border-accent hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">{Icon ? <Icon size={23} aria-hidden="true" /> : <span aria-hidden="true" className="h-6 w-4 rounded-sm" style={{ background: code === "CAUTION" ? "var(--card-yellow)" : "var(--card-red)" }} />}{label}</button>)}</div>
    {breakOnly && !locked && <p role="status" className="mt-4 text-sm text-muted">Durante el descanso solo puedes registrar cambios. Se anotan al inicio del segundo tiempo: {formatClock((report.clock?.halfMinutes ?? 45) * 60)}.</p>}
    {locked && <p className="mt-4 text-sm text-muted">Las acciones requieren un partido en curso y permiso vigente para capturar.</p>}
    <div className="mt-5 border-t border-border pt-4"><p className="font-semibold">Historial del jugador</p>{events.length ? <ul className="mt-3 space-y-2 text-sm">{events.map(e => <li key={e.id} className="rounded-lg bg-soft p-3">{data.eventTypes.find(t => t.code === e.typeCode)?.label ?? e.typeCode}{e.outgoingPlayerId === player.id ? " · Sale" : e.typeCode === "SUBSTITUTION" ? " · Entra" : ""} · {e.periodNumber === null ? "Sin periodo" : `P${e.periodNumber}`} · {eventTimeLabel(e)}</li>)}</ul> : <p className="mt-2 text-sm text-muted">Sin eventos registrados.</p>}</div>
  </FormDialog>;
}
