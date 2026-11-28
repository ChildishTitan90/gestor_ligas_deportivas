import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { playoffRoundDates, playoffRulesSchema } from "@/features/competitions/playoff-qualification";
import { MatchTransitionError } from "../transition-rules";

/** La fecha configurada es específica de la ronda y de la ida o vuelta. */
export async function assertPlayoffDate(tx: Prisma.TransactionClient, matchId: string, date: string) {
  const match = await tx.matches.findUniqueOrThrow({ where: { id: matchId }, select: {
    competition_stages: { select: { format: true, competition_rule_id: true } },
    bracket_matches: { select: { leg_number: true, brackets: { select: { number: true } } } },
  } });
  const stage = match.competition_stages;
  if (!stage || !stage.format || typeof stage.format !== "object" || Array.isArray(stage.format) || stage.format.kind !== "PLAYOFF_8") return;
  const entry = match.bracket_matches;
  if (!entry || entry.brackets.number < 1 || entry.brackets.number > 7) throw new MatchTransitionError("PLAYOFF_DATES_REQUIRED");
  const calendar = await tx.competition_rule_parameters.findFirst({ where: {
    competition_rule_id: stage.competition_rule_id, parameter_key: "calendar", requires_validation: false, validated_by: { not: null },
  }, select: { parameter_value: true } });
  const parsed = z.object({ playoff: playoffRulesSchema.extend({ regularDeadline: z.iso.date(), dates: z.array(z.iso.date()) }) }).safeParse(calendar?.parameter_value);
  if (!parsed.success) throw new MatchTransitionError("PLAYOFF_DATES_REQUIRED");
  const schedule = playoffRoundDates(parsed.data.playoff.format, parsed.data.playoff.dates);
  if (!schedule.ok) throw new MatchTransitionError("PLAYOFF_DATES_REQUIRED");
  const round = entry.brackets.number <= 4 ? "quarterfinals" : entry.brackets.number <= 6 ? "semifinals" : "final";
  const expected = schedule.dates[round][entry.leg_number - 1];
  if (!expected) throw new MatchTransitionError("PLAYOFF_DATES_REQUIRED");
  if (date !== expected) throw new MatchTransitionError("PLAYOFF_ROUND_DATE");
}
