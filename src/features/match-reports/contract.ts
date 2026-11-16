import { z } from "zod";
import { participationTimesSchema } from "@/features/matches/eligibility";
import { tacticSchema } from "./tactics";
import { clockActionSchema, type MatchClock } from "./match-clock";

const id = z.uuid();
export const draftSchema = z.strictObject({
  lineups: z.array(z.strictObject({ playerId: id, teamId: id, selected: z.boolean(), starter: z.boolean(),
    matchJersey: z.number().int().nonnegative().nullable(), periods: participationTimesSchema })).max(100)
    .refine(rows => new Set(rows.map(r => r.playerId)).size === rows.length, "No repitas jugadores."),
  captains: z.record(id, id),
  events: z.array(z.strictObject({ id, typeCode: z.string().min(1).max(80), teamId: id.nullable(), playerId: id.nullable(),
    outgoingPlayerId: id.nullable(), periodNumber: z.number().int().positive().nullable(), minute: z.number().int().nonnegative().nullable(), second: z.number().int().min(0).max(59).nullable().optional(), periodMinute: z.number().int().nonnegative().optional(), description: z.string().max(4000), replacementCaptainId: id.nullable().optional() })).max(300)
    .refine(rows => rows.every(e => e.second == null || e.minute !== null), "Los segundos requieren indicar el minuto.")
    .refine(rows => rows.every(e => e.periodMinute == null || e.periodNumber !== null && e.minute !== null && e.periodMinute <= e.minute), "El minuto relativo requiere periodo y minuto del partido.")
    .refine(rows => new Set(rows.map(r => r.id)).size === rows.length, "No repitas eventos."),
  score: z.strictObject({ home: z.number().int().nonnegative().nullable(), away: z.number().int().nonnegative().nullable() }),
  remarks: z.string().max(8000), incidents: z.string().max(8000),
  signatures: z.record(id, id.nullable()),
  tactics: z.record(id, tacticSchema).optional(),
});
export const reportCommandSchema = z.strictObject({
  formatVersion: z.literal(1), operationId: id, matchId: id, kind: z.enum(["save", "lock-lineups", "clock", "confirm"]), clockAction: clockActionSchema.optional(),
  expectedMatchVersion: z.number().int().positive(), expectedReportVersion: z.number().int().nonnegative(), draft: draftSchema,
}).refine(command => (command.kind === "clock") === Boolean(command.clockAction), "La acción del reloj debe corresponder a la operación.");
export type ReportDraft = z.infer<typeof draftSchema>;
export type ReportCommand = z.infer<typeof reportCommandSchema>;
export type ReportReceipt = { formatVersion: 1; operationId: string; matchId: string; reportId: string; reportVersion: number; matchVersion: number; status: "DRAFT" | "CONFIRMED"; lineupsLock?: { operationId: string; lockedAt: string }; clock?: MatchClock };
export class ReportError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
/** También se usa para vincular firmas; no incluye imágenes, URLs ni referencias de otras firmas. */
export function unsignedDraft(draft: ReportDraft) { return { ...draft, signatures: {} }; }
