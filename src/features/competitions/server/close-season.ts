import "server-only";
import {lockSeasonIdentityHistory} from "@/features/players/server/season-identity-history";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { seasonCloseSchema } from "../schemas";
import { CompetitionError } from "./configuration";

export async function closeSeason(seasonId: string, input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = seasonCloseSchema.safeParse(input);
  if (!z.uuid().safeParse(seasonId).success || !parsed.success) throw new CompetitionError("INVALID_CONFIGURATION");
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    await lockSeasonIdentityHistory(tx);
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
    await assertPermission(tx, actor.id, { module: "competitions", action: "UPDATE", context: { seasonId } });
    const previous = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId } });
    if (previous.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
    if (previous.version !== parsed.data.expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
    if (previous.status !== "ACTIVE") throw new CompetitionError("SEASON_NOT_ACTIVE", 409);
    const pending = await tx.matches.count({ where: { season_id: seasonId, deleted_at: null,
      match_statuses: { code: { not: "CANCELED" } },
      OR: [{ match_statuses: { code: { notIn: ["FINISHED", "NO_SHOW", "ADMINISTRATIVELY_RESOLVED"] } } }, { match_results: null }],
    } });
    if (pending) throw new CompetitionError("UNRESOLVED_MATCHES", 409);
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${parsed.data.reason}, true)`;
    // audit_season registra cierre, actor, motivo y versión en la misma transacción.
    return tx.seasons.update({ where: { id: seasonId }, data: { status: "CLOSED", closed_at: new Date(), version: { increment: 1 } }, select: { id: true, status: true, version: true } });
  });
}
