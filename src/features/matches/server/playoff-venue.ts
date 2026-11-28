import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { playoffRulesSchema } from "@/features/competitions/playoff-qualification";
import { MatchTransitionError } from "../transition-rules";

/** A venue policy constrains both automatic scheduling and subsequent edits. */
export async function playoffVenueAllowed(tx: Prisma.TransactionClient, matchId: string, venueId: string, date: string, source: "OWN" | "HOME_LOAN" | "COMPLEX") {
  const match = await tx.matches.findUniqueOrThrow({ where: { id: matchId }, select: {
    home_team_id: true, competition_stages: { select: { format: true, competition_rule_id: true } },
  } });
  const stage = match.competition_stages;
  if (!stage || !stage.format || typeof stage.format !== "object" || Array.isArray(stage.format) || stage.format.kind !== "PLAYOFF_8") return true;
  const calendar = await tx.competition_rule_parameters.findFirst({ where: { competition_rule_id: stage.competition_rule_id,
    parameter_key: "calendar", requires_validation: false, validated_by: { not: null } }, select: { parameter_value: true } });
  const parsed = z.object({ playoff: playoffRulesSchema.extend({ regularDeadline: z.iso.date().optional(), dates: z.array(z.iso.date()).optional() }) }).safeParse(calendar?.parameter_value);
  if (!parsed.success) throw new MatchTransitionError("PLAYOFF_DATES_REQUIRED");
  const policy = parsed.data.playoff.venuePolicy;
  if (!policy) return true;
  if (policy.mode === "NEUTRAL") return policy.venueIds.includes(venueId);
  if (source === "OWN" || source === "HOME_LOAN") return true;
  const day = new Date(`${date}T00:00:00.000Z`);
  return Boolean(await tx.home_venue_assignments.findFirst({ where: { season_team_id: match.home_team_id,
    venue_id: venueId, weekday: day.getUTCDay() || 7, starts_at: { lte: day }, ends_at: { gte: day }, venue_loan_id: null }, select: { id: true } }));
}
