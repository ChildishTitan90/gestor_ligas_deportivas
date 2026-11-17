import { z } from "zod";
import { uniformKitSchema } from "@/features/clubs/uniform-kits";
import type { MatchReportPresentation, ReportDemoData, ReportEvent, ReportLineup } from "./types";

/** Nombres de las quince formaciones de PFSA; diagramas propios, sin imágenes externas. */
export const formations = ["4-4-2", "4-5-1", "4-3-3", "4-3-2-1", "4-1-3-2", "5-4-1", "4-1-2-1-2", "3-5-2", "5-3-2", "4-2-3-1", "3-4-3", "3-2-4-1", "WM", "2-3-2-3", "4-2-4"] as const;
export const tacticSchema = z.strictObject({
  formation: z.enum([...formations, "CUSTOM"]).nullable(),
  customFormation: z.string().trim().max(40).optional(),
  slots: z.array(z.strictObject({ x: z.number().min(8).max(92), y: z.number().min(8).max(92), playerId: z.uuid().nullable() })).length(11),
  kitSource: z.enum(["home", "away", "custom"]).nullable(), kit: uniformKitSchema.nullable(),
  keeperKit: uniformKitSchema.optional(),
}).refine(t => new Set(t.slots.flatMap(s => s.playerId ? [s.playerId] : [])).size === t.slots.filter(s => s.playerId).length, "No repitas jugadores en el campo.");
export type TeamTactics = z.infer<typeof tacticSchema>;
export type PitchSlot = TeamTactics["slots"][number];

export function formationLines(code: string): number[] | null {
  if (!/^(?:10|[1-9])(?:-(?:10|[1-9])){0,9}$/.test(code.trim())) return null;
  const lines = code.trim().split("-").map(Number);
  return lines.reduce((a, b) => a + b, 0) === 10 ? lines : null;
}
export function keeperKit(tactics: Pick<TeamTactics, "kit" | "keeperKit">) {
  if (tactics.keeperKit) return tactics.keeperKit;
  const yellow = { r: 245, g: 197, b: 66 };
  const closeToYellow = tactics.kit && tactics.kit.primary.r > 180 && tactics.kit.primary.g > 140 && tactics.kit.primary.b < 140;
  return { primary: closeToYellow ? { r: 67, g: 96, b: 187 } : yellow, secondary: { r: 23, g: 40, b: 45 } };
}

export function formationSlots(code: string): PitchSlot[] {
  // WM representa tres defensas, dos medios, dos interiores y tres delanteros.
  const lines = formationLines(code === "WM" ? "3-2-2-3" : code === "CUSTOM" ? "4-4-2" : code);
  if (!lines) throw new Error("INVALID_FORMATION");
  return [{ x: 50, y: 89, playerId: null }, ...lines.flatMap((count, row) => Array.from({ length: count }, (_, column) => ({ x: count === 1 ? 50 : 12 + column * 76 / (count - 1), y: 69 - row * 54 / Math.max(1, lines.length - 1), playerId: null })))];
}
export function teamTactics(data: ReportDemoData, report: MatchReportPresentation, teamId: string): TeamTactics {
  const saved = report.tactics?.[teamId];
  if (saved) return saved;
  const starters = report.lineups.filter(row => row.selected && row.starter && data.players.some(p => p.id === row.playerId && p.teamId === teamId));
  const side = teamId === data.match.home.id ? "home" : "away";
  const kit = data.match[side].uniformKits?.[side] ?? null;
  return { formation: null, slots: formationSlots("4-4-2").map((slot, index) => ({ ...slot, playerId: starters[index]?.playerId ?? null })), kitSource: kit ? side : null, kit };
}

export function orderedEvents(events: ReportEvent[]) {
  const precise = events.every(e => e.second != null);
  // Con tiempos completos, permitir captura posterior fuera de orden. Sin ellos,
  // el orden de captura es explícito; nunca se inventan minutos ni periodos.
  return events.every(e => e.periodNumber !== null && e.minute !== null)
    ? events.map((event, index) => ({ event, index })).sort((a, b) => a.event.periodNumber! - b.event.periodNumber! || (a.event.periodMinute ?? a.event.minute!) - (b.event.periodMinute ?? b.event.minute!) || (precise ? a.event.second! - b.event.second! : 0) || a.index - b.index).map(row => row.event)
    : events;
}
export function eventTimeLabel(event: Pick<ReportEvent, "minute" | "second">) {
  return event.minute === null ? "Sin minuto" : event.second == null ? `${event.minute}′ · segundos sin indicar` : `${String(event.minute).padStart(2, "0")}:${String(event.second).padStart(2, "0")}`;
}
/** Conserva las dos amonestaciones como evidencia; no fabrica una roja directa
 * ni otra operación de guardado. El segundo evento es la causa de expulsión. */
export function dismissalEvents(events: ReportEvent[]) {
  const yellows = new Map<string, number>();
  const dismissed = new Set<string>();
  return [...new Set(events.map(e => e.teamId))].flatMap(teamId => orderedEvents(events.filter(e => e.teamId === teamId && ["SUBSTITUTION", "CAUTION", "SENDING_OFF"].includes(e.typeCode))).filter(event => {
    if (event.typeCode === "SUBSTITUTION") return false;
    if (!event.playerId || !event.teamId) return false;
    const key = `${event.teamId}:${event.playerId}`;
    if (dismissed.has(key)) return false;
    if (event.typeCode === "SENDING_OFF") { dismissed.add(key); return true; }
    const count = (yellows.get(key) ?? 0) + 1; yellows.set(key, count);
    if (count === 2) dismissed.add(key);
    return count === 2;
  }));
}
export function currentPitch(slots: PitchSlot[], events: ReportEvent[], teamId: string) {
  const current = slots.map(slot => ({ ...slot }));
  const removed = new Set<string>();
  const problems: string[] = [];
  const dismissals = new Set(dismissalEvents(events).map(e => e.id));
  for (const event of orderedEvents(events.filter(e => e.teamId === teamId && ["SUBSTITUTION", "SENDING_OFF", "CAUTION"].includes(e.typeCode)))) {
    if (dismissals.has(event.id) && event.playerId) {
      const slot = current.find(slot => slot.playerId === event.playerId);
      if (slot) slot.playerId = null;
      removed.add(event.playerId);
    }
    if (event.typeCode === "SUBSTITUTION") {
      const slot = current.find(slot => slot.playerId === event.outgoingPlayerId);
      if (!slot || !event.playerId || current.some(s => s.playerId === event.playerId) || removed.has(event.playerId)) { problems.push(event.id); continue; }
      removed.add(event.outgoingPlayerId!);
      slot.playerId = event.playerId;
    }
  }
  return { slots: current, removed, problems };
}
/** Reconstruye la banca en el instante de un cambio capturado posteriormente.
 * En vivo se usa currentPitch directamente; indicar un minuto no abre el plantel. */
export function eventsBeforePlayerEvent(events: ReportEvent[], teamId: string, candidate: ReportEvent) {
  const timeline = events.some(e => e.id === candidate.id) ? events.map(e => e.id === candidate.id ? candidate : e) : [...events, candidate];
  const ordered = orderedEvents(timeline.filter(e => e.teamId === teamId && (e.id === candidate.id || ["SUBSTITUTION", "SENDING_OFF", "CAUTION"].includes(e.typeCode))));
  return ordered.slice(0, ordered.findIndex(e => e.id === candidate.id));
}

export function pitchBeforeChange(slots: PitchSlot[], events: ReportEvent[], teamId: string, candidate: ReportEvent) { return currentPitch(slots, eventsBeforePlayerEvent(events, teamId, candidate), teamId); }

/** Proyección reversible: conserva los tiempos manuales del borrador separados
 * de los derivados de cambios/expulsiones. Editar o quitar un evento recalcula
 * la proyección; solo se rellenan tiempos expresamente capturados. */
export function participationPeriods(row: ReportLineup, events: ReportEvent[]) {
  const periods = row.periods.map(p => ({ ...p }));
  const dismissals = new Set(dismissalEvents(events).map(e => e.id));
  for (const event of orderedEvents(events.filter(e => e.typeCode === "SUBSTITUTION" || dismissals.has(e.id)))) {
    if (event.periodNumber === null || event.minute === null) continue;
    const enters = event.typeCode === "SUBSTITUTION" && event.playerId === row.playerId;
    const leaves = event.outgoingPlayerId === row.playerId || (dismissals.has(event.id) && event.playerId === row.playerId);
    if (!enters && !leaves) continue;
    let period = periods.find(p => p.periodNumber === event.periodNumber);
    if (!period) { period = { periodNumber: event.periodNumber, entryMinute: null, exitMinute: null }; periods.push(period); }
    if (enters) period.entryMinute = event.periodMinute ?? event.minute;
    if (leaves) period.exitMinute = event.periodMinute ?? event.minute;
  }
  return periods.sort((a, b) => a.periodNumber - b.periodNumber);
}
