import "server-only";
import {lockSeasonIdentityHistory} from "@/features/players/server/season-identity-history";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { seasonCloseSchema } from "../schemas";
import { CompetitionError } from "./configuration";
import type { Prisma } from "@prisma/client";

/** La ausencia de partidos todavía no creados no significa que la liguilla haya concluido. */
export async function assertPlayoffsComplete(tx: Prisma.TransactionClient, seasonId: string) {
  const categories = await tx.season_categories.findMany({ where: { season_id: seasonId }, select: {
    competition_rules: { select: { competition_rule_parameters: { where: { parameter_key: "calendar" }, select: { parameter_value: true } } } },
    competition_stages: { select: { format: true, brackets: { select: { number: true, team_a_id: true, team_b_id: true, winner_id: true } } } },
  } });
  for (const category of categories) {
    const calendar = category.competition_rules.competition_rule_parameters[0]?.parameter_value;
    const configured = calendar && typeof calendar === "object" && !Array.isArray(calendar) && calendar.playoff != null;
    const stages = category.competition_stages.filter(stage => stage.format && typeof stage.format === "object" && !Array.isArray(stage.format) && stage.format.kind === "PLAYOFF_8");
    if (!configured && !stages.length) continue;
    if (stages.length !== 1) throw new CompetitionError("UNRESOLVED_PLAYOFF", 409);
    const brackets = stages[0].brackets;
    if (brackets.length !== 7 || brackets.some(b => b.number < 1 || b.number > 7 || !b.team_a_id || !b.team_b_id || !b.winner_id || ![b.team_a_id,b.team_b_id].includes(b.winner_id)))
      throw new CompetitionError("UNRESOLVED_PLAYOFF", 409);
  }
}

export async function closeSeason(seasonId: string, input: unknown) {
  const actor = await requireOperationalUser();
  return closeSeasonForActor(actor.id, seasonId, input);
}

export async function closeSeasonForActor(actorId: string, seasonId: string, input: unknown) {
  const parsed = seasonCloseSchema.safeParse(input);
  if (!z.uuid().safeParse(seasonId).success || !parsed.success) throw new CompetitionError("INVALID_CONFIGURATION");
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    await lockSeasonIdentityHistory(tx);
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
    await assertPermission(tx, actorId, { module: "competitions", action: "UPDATE", context: { seasonId } });
    const previous = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId } });
    if (previous.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
    if (previous.version !== parsed.data.expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
    if (previous.status !== "ACTIVE") throw new CompetitionError("SEASON_NOT_ACTIVE", 409);
    const pending = await tx.matches.count({ where: { season_id: seasonId, deleted_at: null,
      match_statuses: { code: { not: "CANCELED" } },
      OR: [{ match_statuses: { code: { notIn: ["FINISHED", "NO_SHOW", "ADMINISTRATIVELY_RESOLVED"] } } }, { match_results: null }],
    } });
    if (pending) throw new CompetitionError("UNRESOLVED_MATCHES", 409);
    await assertPlayoffsComplete(tx, seasonId);
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true), set_config('app.reason', ${parsed.data.reason}, true)`;
    // audit_season registra cierre, actor, motivo y versión en la misma transacción.
    return tx.seasons.update({ where: { id: seasonId }, data: { status: "CLOSED", closed_at: new Date(), version: { increment: 1 } }, select: { id: true, status: true, version: true } });
  });
}
