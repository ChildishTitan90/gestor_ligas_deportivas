import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { categoryCatalogSchema, associateCategorySchema } from "../schemas";
import { CompetitionError } from "./configuration";

function validId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new CompetitionError("INVALID_CONFIGURATION");
}
function duplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    throw new CompetitionError("CATEGORY_ALREADY_EXISTS", 409);
  throw error;
}
export async function listCategoryCatalog(leagueId: string) {
  const actor = await requireOperationalUser(); validId(leagueId);
  return getPrisma().$transaction(async tx => {
    await assertPermission(tx, actor.id, { module: "competitions", action: "READ", context: { leagueId } });
    return { items: await tx.categories.findMany({ where: { league_id: leagueId, sports: { code: "SOCCER" } },
      select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }) };
  });
}
export async function createCategoryCatalog(input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = categoryCatalogSchema.safeParse(input);
  if (!parsed.success) throw new CompetitionError("INVALID_CONFIGURATION");
  const data = parsed.data;
  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx);
      await assertPermission(tx, actor.id, { module: "competitions", action: "CREATE", context: { leagueId: data.leagueId } });
      const leagues = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sports_management.leagues WHERE id=${data.leagueId}::uuid AND is_active FOR SHARE`;
      const sport = await tx.sports.findUnique({ where: { code: "SOCCER" }, select: { id: true } });
      if (!leagues.length || !sport) throw new CompetitionError("INVALID_CONTEXT");
      const category = await tx.categories.create({ data: { league_id: data.leagueId, sport_id: sport.id, name: data.name }, select: { id: true, name: true } });
      // El catálogo no tiene trigger record_audit.
      await tx.audit_logs.create({ data: { user_id: actor.id, table_name: "categories", entity_id: category.id,
        action: "INSERT", reason: data.reason, new_data: { name: category.name, leagueId: data.leagueId } } });
      return category;
    });
  } catch (error) { return duplicate(error); }
}

export async function listSeasonCategories(seasonId: string) {
  const actor = await requireOperationalUser(); validId(seasonId);
  return getPrisma().$transaction(async tx => {
    await assertPermission(tx, actor.id, { module: "competitions", action: "READ", context: { seasonId } });
    const items = await tx.season_categories.findMany({ where: { season_id: seasonId },
      select: { id: true, category_id: true, competition_rule_id: true, hierarchy_order: true, type: true,
        competition_format: true, eligibility_pending: true, player_policy: true, age_cutoff_date: true, minimum_age: true, maximum_age: true,
        categories: { select: { name: true } } }, orderBy: [{ hierarchy_order: "asc" }, { id: "asc" }] });
    return { items: items.map(item => ({ id: item.id, categoryId: item.category_id, name: item.categories.name,
      ruleId: item.competition_rule_id, hierarchyOrder: item.hierarchy_order, type: item.type, format: item.competition_format,
      eligibilityPending: item.eligibility_pending, ageCutoffDate: item.age_cutoff_date?.toISOString().slice(0, 10) ?? null,
      minimumAge: item.minimum_age, maximumAge: item.maximum_age, playerPolicy: item.player_policy })) };
  });
}
export async function associateSeasonCategory(seasonId: string, input: unknown) {
  const actor = await requireOperationalUser(); validId(seasonId);
  const parsed = associateCategorySchema.safeParse(input);
  if (!parsed.success) throw new CompetitionError("INVALID_CONFIGURATION");
  const data = parsed.data;
  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx);
      await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
      await assertPermission(tx, actor.id, { module: "competitions", action: "UPDATE", context: { seasonId } });
      const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId } });
      if (season.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
      if (season.status !== "PLANNED" || season.competition_starts_at) throw new CompetitionError("COMPETITION_ALREADY_STARTED", 409);
      if (season.version !== data.expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
      const category = await tx.categories.findFirst({ where: { id: data.categoryId, league_id: season.league_id,
        sport_id: season.sport_id, sports: { code: "SOCCER" } }, select: { id: true } });
      const rule = await tx.competition_rules.findFirst({ where: { id: data.ruleId, season_id: seasonId }, select: { id: true } });
      if (!category || !rule) throw new CompetitionError("INVALID_CONTEXT");
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${data.reason}, true)`;
      const result = await tx.season_categories.create({ data: { season_id: seasonId, category_id: category.id,
        competition_rule_id: rule.id, hierarchy_order: data.hierarchyOrder, type: data.type, eligibility_pending: true }, select: { id: true } });
      await tx.audit_logs.create({ data: { user_id: actor.id, action: "INSERT", table_name: "season_categories", entity_id: result.id,
        reason: data.reason, new_data: { seasonId, categoryId: category.id, ruleId: rule.id, eligibilityPending: true,
          hierarchyOrder: data.hierarchyOrder, type: data.type } } });
      // audit_season registra este incremento dentro de la misma transacción.
      const updated = await tx.seasons.update({ where: { id: seasonId }, data: { version: { increment: 1 } }, select: { version: true } });
      return { id: result.id, seasonVersion: updated.version, eligibilityPending: true };
    });
  } catch (error) { return duplicate(error); }
}
