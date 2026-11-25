import { z } from "zod";
import type { ReportEvent } from "./types";

export const clockActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("start"), halfMinutes: z.number().int().min(1).max(120), breakMinutes: z.number().int().min(1).max(120) }),
  z.strictObject({ type: z.literal("add-time"), minutes: z.number().int().min(0).max(60) }),
  z.strictObject({ type: z.literal("end-half") }),
  z.strictObject({ type: z.literal("set-break"), minutes: z.number().int().min(1).max(120) }),
  z.strictObject({ type: z.literal("start-second") }),
]);
const boundaryKeys = ["firstStartedAt", "firstEndedAt", "secondStartedAt", "secondEndedAt"] as const;
type Boundary = typeof boundaryKeys[number];
type ClockSource = "server" | "device";
export const matchClockSchema = z.strictObject({
  boundaries: z.strictObject({ firstStartedAt: z.iso.datetime().optional(), firstEndedAt: z.iso.datetime().optional(),
    secondStartedAt: z.iso.datetime().optional(), secondEndedAt: z.iso.datetime().optional() }).optional(),
  boundarySources: z.partialRecord(z.enum(boundaryKeys), z.enum(["server", "device"])).optional(),
  phase: z.enum(["FIRST_HALF", "BREAK", "SECOND_HALF", "ENDED"]),
  phaseStartedAt: z.iso.datetime(), endedAt: z.iso.datetime().nullable(),
  halfMinutes: z.number().int().min(1).max(120), breakMinutes: z.number().int().min(1).max(120),
  extraMinutes: z.number().int().min(0).max(60), extraDeclared: z.boolean(),
});
export type ClockAction = z.infer<typeof clockActionSchema>;
export type MatchClock = z.infer<typeof matchClockSchema>;
export function verifiedClockBoundaries(clock?: MatchClock | null) {
  const verified: Partial<Record<Boundary, string>> = {};
  for (const key of boundaryKeys) {
    if (clock?.boundarySources?.[key] === "server" && clock.boundaries?.[key]) verified[key] = clock.boundaries[key];
  }
  return verified;
}
export function advanceMatchClock(current: MatchClock | null, action: ClockAction, now: string, source: ClockSource = "device"): MatchClock {
  const mark = (key: Boundary) => ({
    boundaries: { ...current?.boundaries, [key]: now },
    boundarySources: { ...current?.boundarySources, [key]: source },
  });
  if (action.type === "start") {
    if (current) throw Error("CLOCK_ALREADY_STARTED");
    return { ...mark("firstStartedAt"), phase: "FIRST_HALF", phaseStartedAt: now, endedAt: null, halfMinutes: action.halfMinutes, breakMinutes: action.breakMinutes, extraMinutes: 0, extraDeclared: false };
  }
  if (!current) throw Error("CLOCK_NOT_STARTED");
  const running = current.phase === "FIRST_HALF" || current.phase === "SECOND_HALF";
  if (action.type === "add-time" && running) return { ...current, extraMinutes: action.minutes, extraDeclared: true };
  if (action.type === "set-break" && current.phase === "BREAK") return { ...current, breakMinutes: action.minutes };
  if (action.type === "start-second" && current.phase === "BREAK") return { ...current, ...mark("secondStartedAt"), phase: "SECOND_HALF", phaseStartedAt: now, extraMinutes: 0, extraDeclared: false };
  if (action.type === "end-half" && running) return current.phase === "FIRST_HALF" ? { ...current, ...mark("firstEndedAt"), phase: "BREAK", phaseStartedAt: now, extraMinutes: 0, extraDeclared: false } : { ...current, ...mark("secondEndedAt"), phase: "ENDED", endedAt: now };
  throw Error("CLOCK_PHASE_CONFLICT");
}
export function clockReading(clock: MatchClock, now: number) {
  const elapsed = Math.max(0, Math.floor(((clock.endedAt ? Date.parse(clock.endedAt) : now) - Date.parse(clock.phaseStartedAt)) / 1000));
  const running = clock.phase === "FIRST_HALF" || clock.phase === "SECOND_HALF";
  const base = (clock.phase === "BREAK" ? clock.breakMinutes : clock.halfMinutes) * 60;
  const periodMinute = clock.phase === "BREAK" ? 0 : Math.floor(elapsed / 60);
  const minute = periodMinute + (clock.phase === "FIRST_HALF" ? 0 : clock.halfMinutes);
  return { elapsed, running, periodNumber: clock.phase === "FIRST_HALF" ? 1 : 2, minute, periodMinute, second: clock.phase === "BREAK" ? 0 : elapsed % 60, remaining: Math.max(0, base - elapsed), baseReached: elapsed >= base, timeReached: elapsed >= base + clock.extraMinutes * 60 };
}
/** Solo examina eventos nuevos o modificados; los antecedentes no cambian al descansar.
 * La fase procede del servidor, nunca de una hora/fase declarada por el navegador. */
export function breakEventError(clock: MatchClock | null, previous: ReportEvent[], next: ReportEvent[]) {
  if (clock?.phase !== "BREAK") return null;
  for (const event of next) {
    const old = previous.find(e => e.id === event.id);
    if (old && [...new Set([...Object.keys(old), ...Object.keys(event)])].every(key => (old[key as keyof ReportEvent] ?? null) === (event[key as keyof ReportEvent] ?? null))) continue;
    if (event.typeCode !== "SUBSTITUTION") return "BREAK_SUBSTITUTIONS_ONLY";
    if (event.periodNumber !== 2 || event.minute !== clock.halfMinutes || event.second !== 0 || event.periodMinute !== 0) return "BREAK_SUBSTITUTION_TIME";
  }
  return null;
}
export const formatClock = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0")}:${(Math.max(0, seconds) % 60).toString().padStart(2, "0")}`;
