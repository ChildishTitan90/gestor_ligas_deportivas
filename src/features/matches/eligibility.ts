import { z } from "zod";

export type Blocker = { code: string; message: string };
export type MatchPlayer = {
  registrationId: string; name: string; team: string; targetTeam: string; seasonTeamId: string;
  jerseyNumber: number | null; eligible: boolean; blockers: Blocker[];
  participation: { matchNumber: string; period: number; entry: number | null; exit: number | null }[];
};
export type LineupEvaluation = {
  matchId: string; number: string; version: number; startsAt: string | null;
  historical: boolean; players: MatchPlayer[]; notices: string[];
};

/** Minutos relativos al periodo, no horas absolutas ni duraciones inventadas. */
export const participationTimesSchema = z.array(z.strictObject({
  periodNumber: z.number().int().positive(),
  entryMinute: z.number().int().nonnegative().nullable(),
  exitMinute: z.number().int().nonnegative().nullable(),
}).refine(p => p.entryMinute === null || p.exitMinute === null || p.exitMinute >= p.entryMinute,
  "La salida debe ser posterior o igual a la entrada.")).max(20)
  .refine(rows => new Set(rows.map(r => r.periodNumber)).size === rows.length, "No repitas un periodo.");
