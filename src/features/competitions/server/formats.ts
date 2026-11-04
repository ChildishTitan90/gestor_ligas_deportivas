import "server-only";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { generalTableSchema } from "../schemas";
import { CompetitionError } from "./configuration";

export async function configureGeneralTable(seasonId: string, participationId: string, input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = generalTableSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(seasonId).success || !z.uuid().safeParse(participationId).success)
    throw new CompetitionError("INVALID_CONFIGURATION");
  const data = parsed.data;
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
    await assertPermission(tx, actor.id, { module: "competitions", action: "UPDATE", context: { seasonId } });
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId } });
    if (season.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
    if (season.status !== "PLANNED" || season.competition_starts_at) throw new CompetitionError("COMPETITION_ALREADY_STARTED", 409);
    if (season.version !== data.expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
    const category = await tx.season_categories.findFirst({ where: { id: participationId, season_id: seasonId } });
    if (!category) throw new CompetitionError("INVALID_CONTEXT");
    if (category.competition_format !== "LEGACY_GROUPS") throw new CompetitionError("FORMAT_ALREADY_CONFIGURED", 409);
    if (await tx.groups.count({ where: { season_category_id: participationId } })) throw new CompetitionError("FORMAT_HAS_GROUPS", 409);
    if (await tx.club_affiliation_categories.count({ where: { season_id: seasonId, category_id: category.category_id } }))
      throw new CompetitionError("FORMAT_IN_USE", 409);
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${data.reason}, true)`;
    await tx.season_categories.update({ where: { id: participationId }, data: { competition_format: data.format } });
    const group = data.format === "GENERAL_TABLE" ? await tx.groups.create({ data: { season_id: seasonId, season_category_id: participationId, name: "General" }, select: { id: true, name: true } }) : null;
    await tx.audit_logs.create({ data: { user_id: actor.id, action: "UPDATE", table_name: "season_categories", entity_id: participationId,
      previous_data: { format: category.competition_format }, new_data: { format: data.format, groupId: group?.id ?? null }, reason: data.reason } });
    if (group) await tx.audit_logs.create({ data: { user_id: actor.id, action: "INSERT", table_name: "groups", entity_id: group.id,
      new_data: { name: group.name, seasonId, participationId }, reason: data.reason } });
    const updated = await tx.seasons.update({ where: { id: seasonId }, data: { version: { increment: 1 } }, select: { version: true } });
    return { id: participationId, format: data.format, group, seasonVersion: updated.version };
  });
}
