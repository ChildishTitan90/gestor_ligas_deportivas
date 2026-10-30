import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { groupCreateSchema, groupRenameSchema, groupDeleteSchema } from "../schemas";
import { CompetitionError } from "./configuration";

function validIds(seasonId: string, participationId: string) {
  if (!z.uuid().safeParse(seasonId).success || !z.uuid().safeParse(participationId).success)
    throw new CompetitionError("INVALID_CONFIGURATION");
}
async function participation(tx: Prisma.TransactionClient, seasonId: string, participationId: string) {
  const item = await tx.season_categories.findFirst({ where: { id: participationId, season_id: seasonId }, select: { id: true } });
  if (!item) throw new CompetitionError("INVALID_CONTEXT");
  return item;
}
export async function listCompetitionGroups(seasonId: string, participationId: string) {
  const actor = await requireOperationalUser(); validIds(seasonId, participationId);
  return getPrisma().$transaction(async tx => {
    await assertPermission(tx, actor.id, { module: "competitions", action: "READ", context: { seasonId } });
    await participation(tx, seasonId, participationId);
    return { items: await tx.groups.findMany({ where: { season_id: seasonId, season_category_id: participationId },
      select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }) };
  });
}

export async function mutateCompetitionGroup(seasonId: string, participationId: string,
  operation: "CREATE" | "RENAME" | "DELETE", input: unknown) {
  const actor = await requireOperationalUser(); validIds(seasonId, participationId);
  const schema = operation === "CREATE" ? groupCreateSchema : operation === "RENAME" ? groupRenameSchema : groupDeleteSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CompetitionError("INVALID_CONFIGURATION");
  const data = parsed.data;
  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx);
      await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
      await assertPermission(tx, actor.id, { module: "competitions", action: operation === "CREATE" ? "CREATE" : "UPDATE", context: { seasonId } });
      const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId }, select: { status: true, version: true, competition_starts_at: true } });
      if (season.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
      if (season.status !== "PLANNED" || season.competition_starts_at) throw new CompetitionError("COMPETITION_ALREADY_STARTED", 409);
      if (season.version !== data.expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
      await participation(tx, seasonId, participationId);
      const configuration = await tx.season_categories.findUniqueOrThrow({ where: { id: participationId }, select: { competition_format: true } });
      if (configuration.competition_format === "GENERAL_TABLE") throw new CompetitionError("GENERAL_GROUP_MANAGED_AUTOMATICALLY", 409);
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${data.reason}, true)`;
      let before: { id: string; name: string } | null = null;
      let result: { id: string; name: string };
      if (operation === "CREATE" && "name" in data) {
        result = await tx.groups.create({ data: { name: data.name, season_id: seasonId, season_category_id: participationId }, select: { id: true, name: true } });
      } else {
        if (!("groupId" in data)) throw new CompetitionError("INVALID_CONFIGURATION");
        // El bloqueo de fila se conserva hasta verificar referencias y escribir.
        await tx.$queryRaw`SELECT id FROM sports_management.groups WHERE id=${data.groupId}::uuid FOR UPDATE`;
        before = await tx.groups.findFirst({ where: { id: data.groupId, season_id: seasonId, season_category_id: participationId },
          select: { id: true, name: true } });
        if (!before) throw new CompetitionError("INVALID_CONTEXT");
        // Protege equipos, partidos y clasificaciones; RESTRICT es defensa final.
        const teams = await tx.season_teams.count({ where: { group_id: before.id } });
        const matches = await tx.matches.count({ where: { group_id: before.id } });
        const standings = await tx.standing_versions.count({ where: { group_id: before.id } });
        if (teams || matches || standings) throw new CompetitionError("GROUP_IN_USE", 409);
        result = operation === "DELETE" ? await tx.groups.delete({ where: { id: before.id }, select: { id: true, name: true } }) :
          await tx.groups.update({ where: { id: before.id }, data: { name: groupRenameSchema.parse(data).name }, select: { id: true, name: true } });
      }
      await tx.audit_logs.create({ data: { user_id: actor.id, action: operation === "CREATE" ? "INSERT" : operation === "RENAME" ? "UPDATE" : "DELETE",
        table_name: "groups", entity_id: result.id, reason: data.reason,
        previous_data: before ? { name: before.name, seasonId, participationId } : Prisma.JsonNull,
        new_data: operation === "DELETE" ? Prisma.JsonNull : { name: result.name, seasonId, participationId } } });
      const updated = await tx.seasons.update({ where: { id: seasonId }, data: { version: { increment: 1 } }, select: { version: true } });
      return { ...result, seasonVersion: updated.version, deleted: operation === "DELETE" };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new CompetitionError("GROUP_ALREADY_EXISTS", 409);
      if (error.code === "P2003") throw new CompetitionError("GROUP_IN_USE", 409);
    }
    throw error;
  }
}
