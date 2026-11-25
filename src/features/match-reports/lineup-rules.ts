import type { ReportDraft } from "./contract";
import type { MatchReportPresentation, ReportDemoData } from "./types";
import { formationLines, keeperKit } from "./tactics";

export function jerseyErrors(data: ReportDemoData, report: MatchReportPresentation): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const row of report.lineups.filter(r => r.selected)) {
    if (row.matchJersey === null || !Number.isInteger(row.matchJersey) || row.matchJersey < 0) { errors[row.playerId] = "Indica un dorsal entero no negativo."; continue; }
    const teamId = data.players.find(p => p.id === row.playerId)?.teamId;
    const duplicate = report.lineups.find(other => other.selected && other.playerId !== row.playerId && other.matchJersey === row.matchJersey && data.players.some(p => p.id === other.playerId && p.teamId === teamId));
    if (duplicate) errors[row.playerId] = `El dorsal ${row.matchJersey} también lo usa ${data.players.find(p => p.id === duplicate.playerId)?.name ?? "otro jugador"} en este equipo.`;
  }
  return errors;
}

/** Identidad del once inicial. Los tiempos, eventos y firmas pueden avanzar.
 * Omitir filas sin convocar no cambia un once guardado. El orden de la captura
 * tampoco permite eludir el bloqueo ni produce conflictos artificiales. */
export function lineupSnapshot(draft: ReportDraft) {
  return {
    players: draft.lineups.filter(r => r.selected).map(r => ({ playerId: r.playerId, teamId: r.teamId, starter: r.starter, jersey: r.matchJersey, ...(r.participationHalf ? { participationHalf: r.participationHalf } : {}) })).sort((a, b) => a.playerId.localeCompare(b.playerId)),
    captains: Object.entries(draft.captains).sort(([a], [b]) => a.localeCompare(b)),
    tactics: Object.entries(draft.tactics ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([teamId, t]) => ({ teamId, formation: t.formation, customFormation: t.formation === "CUSTOM" ? t.customFormation?.trim() ?? "" : "", slots: t.slots, kitSource: t.kitSource, kit: t.kit, keeperKit: keeperKit(t) })),
  };
}
export function lineupFingerprint(draft: ReportDraft): string {
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
    return JSON.stringify(value);
  }
  return canonical(lineupSnapshot(draft));
}
export function lineupSealIssues(data: ReportDemoData, report: MatchReportPresentation) {
  const issues = Object.values(jerseyErrors(data, report));
  for (const team of [data.match.home, data.match.away]) {
    const rows = report.lineups.filter(r => r.selected && data.players.some(p => p.id === r.playerId && p.teamId === team.id));
    const tactics = report.tactics?.[team.id];
    if (!rows.some(r => r.starter)) issues.push(`${team.shortName}: asigna a los titulares en el campo.`);
    if (!rows.some(r => r.playerId === report.captains[team.id])) issues.push(`${team.shortName}: elige un capitán convocado.`);
    if (!tactics?.formation || (tactics.formation === "CUSTOM" && !formationLines(tactics.customFormation ?? ""))) issues.push(`${team.shortName}: indica la formación; sus líneas deben sumar diez jugadores sin contar al portero.`);
    if (tactics?.kit && JSON.stringify(keeperKit(tactics).primary) === JSON.stringify(tactics.kit.primary)) issues.push(`${team.shortName}: el portero debe usar un color principal diferente.`);
  }
  return [...new Set(issues)];
}
