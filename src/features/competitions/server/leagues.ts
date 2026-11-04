import "server-only";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { createLeagueSchema } from "../schemas";
import { CompetitionError } from "./configuration";

export async function canCreateLeague() {
  const actor = await requireOperationalUser();
  try {
    await getPrisma().$transaction(tx => assertPermission(tx, actor.id, { module: "leagues", action: "CREATE", context: {} }));
    return true;
  } catch (error) {
    if (error instanceof AuthorizationError) return false;
    throw error;
  }
}

export async function createLeague(input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = createLeagueSchema.safeParse(input);
  if (!parsed.success) throw new CompetitionError("INVALID_LEAGUE");
  const { name, timezone, reason } = parsed.data;
  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx);
      await assertPermission(tx, actor.id, { module: "leagues", action: "CREATE", context: {} });
      const league = await tx.leagues.create({ data: { name, timezone }, select: { id: true, name: true, timezone: true } });
      await tx.audit_logs.create({ data: { user_id: actor.id, action: "INSERT", table_name: "leagues", entity_id: league.id,
        reason, new_data: { name, timezone, isActive: true } } });
      return league;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CompetitionError("DUPLICATE_LEAGUE", 409);
    throw error;
  }
}
