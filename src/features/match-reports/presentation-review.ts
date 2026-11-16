import { effectiveCaptain } from "./captaincy";
import { currentPitch, participationPeriods } from "./tactics";
import { participationTimesSchema } from "@/features/matches/eligibility";
import type { MatchReportPresentation, ReportDemoData } from "./types";

/** Comprobaciones de interfaz; no certifican permisos, elegibilidad ni reglas de Liga. */
export function reviewReportPresentation(data: ReportDemoData, report: MatchReportPresentation): string[] {
  const issues: string[] = [];
  const selected = report.lineups.filter(row => row.selected);
  for (const team of [data.match.home, data.match.away]) {
    const rows = selected.filter(row => data.players.some(player => player.id === row.playerId && player.teamId === team.id));
    if (!rows.length) issues.push(`${team.shortName}: selecciona a los participantes.`);
    if (!rows.some(row => row.playerId === report.captains[team.id])) issues.push(`${team.shortName}: selecciona un capitán de la alineación.`);
    if (!report.signatures[team.id] || report.signatures[team.id]?.captainId !== effectiveCaptain(report.captains[team.id],report.events,team.id)) issues.push(`${team.shortName}: falta capturar y confirmar la firma del capitán.`);
    const tactics = report.tactics?.[team.id];
    if (tactics && currentPitch(tactics.slots, report.events, team.id).problems.length) issues.push(`${team.shortName}: revisa la secuencia de cambios.`);
    if (rows.filter(row => row.starter).length > 11) issues.push(`${team.shortName}: hay más de once titulares.`);
    const jerseys = rows.map(row => row.matchJersey).filter(value => value !== null);
    if (new Set(jerseys).size !== jerseys.length) issues.push(`${team.shortName}: hay dorsales repetidos en este partido.`);
  }
  for (const row of selected) {
    const player = data.players.find(player => player.id === row.playerId);
    if (!player?.eligible) issues.push(`${player?.name ?? "Jugador"}: no está habilitado para alinear.`);
    if (row.matchJersey === null || !Number.isInteger(row.matchJersey) || row.matchJersey < 0) issues.push(`${player?.name}: indica un dorsal entero no negativo.`);
    if (!participationTimesSchema.safeParse(participationPeriods(row, report.events)).success) issues.push(`${player?.name}: revisa los periodos y el orden de entrada/salida.`);
  }
  if ([report.score.home, report.score.away].some(value => value === null || !Number.isInteger(value) || value < 0)) issues.push("Completa el marcador con enteros no negativos.");
  for (const event of report.events) {
    const type = data.eventTypes.find(type => type.code === event.typeCode);
    if (!type) { issues.push("Hay un evento fuera del catálogo del partido."); continue; }
    if (type.team === "required" && !event.teamId) issues.push(`${type.label}: falta el equipo.`);
    if (type.player === "required" && !event.playerId) issues.push(`${type.label}: falta el jugador.`);
    if (event.typeCode === "SUBSTITUTION" && (!event.outgoingPlayerId || event.outgoingPlayerId === event.playerId)) issues.push("Cambio: indica dos jugadores diferentes.");
    for (const playerId of [event.playerId, event.outgoingPlayerId].filter(Boolean)) {
      if (!selected.some(row => row.playerId === playerId) || !data.players.some(player => player.id === playerId && player.teamId === event.teamId)) issues.push(`${type.label}: el jugador debe pertenecer a la alineación del equipo.`);
    }
  }
  return [...new Set(issues)];
}
