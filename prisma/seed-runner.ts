import type { PrismaClient } from "@prisma/client";
import { SEED_ACTOR, SEED_AUDIT_REASON, SEED_CONTEXT, SEED_ROLES } from "./seed-data";
import { SeedConfigurationError } from "./seed-env";

export async function seedDatabase(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    // Serializa ejecuciones de este seed, incluyendo sus lecturas y creaciones.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(47, 2026)::text`;
    for (const role of SEED_ROLES) {
      await tx.roles.upsert({ where: { code: role.code }, update: {}, create: role });
    }
    const sport = await tx.sports.findUniqueOrThrow({ where: { code: "SOCCER" } });
    const person = await tx.people.upsert({
      where: { id: SEED_ACTOR.personId }, update: {},
      create: { id: SEED_ACTOR.personId, first_name: SEED_ACTOR.firstName,
        paternal_surname: SEED_ACTOR.surname },
    });
    if (person.first_name !== SEED_ACTOR.firstName ||
        person.paternal_surname !== SEED_ACTOR.surname || person.curp !== null) {
      throw new SeedConfigurationError("La identidad reservada del seed pertenece a otros datos; no se modificó.");
    }
    const actor = await tx.users.upsert({
      where: { person_id: person.id }, update: {},
      create: { person_id: person.id, username: SEED_ACTOR.username,
        email: SEED_ACTOR.email, password_hash: SEED_ACTOR.passwordHash,
        is_active: false, must_change_password: true },
    });
    if (actor.username !== SEED_ACTOR.username || actor.email !== SEED_ACTOR.email ||
        actor.is_active || actor.password_hash !== SEED_ACTOR.passwordHash ||
        await tx.user_roles.count({ where: { user_id: actor.id } }) !== 0) {
      throw new SeedConfigurationError("El actor reservado de auditoría fue alterado; no se modificó.");
    }
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
      set_config('app.reason', ${SEED_AUDIT_REASON}, true)`;

    const league = await tx.leagues.findUnique({ where: { name: SEED_CONTEXT.leagueName } })
      ?? await tx.leagues.create({ data: { name: SEED_CONTEXT.leagueName, timezone: "America/Mexico_City" } });
    if (league.timezone !== "America/Mexico_City" || !league.is_active) {
      throw new SeedConfigurationError("La liga sintética existente no coincide con el fixture; no se sobrescribió.");
    }
    const seasonKey = { league_id: league.id, sport_id: sport.id, name: SEED_CONTEXT.seasonName };
    const season = await tx.seasons.findUnique({ where: { league_id_sport_id_name: seasonKey } })
      ?? await tx.seasons.create({ data: { ...seasonKey,
        start_date: new Date(`${SEED_CONTEXT.startDate}T00:00:00Z`),
        end_date: new Date(`${SEED_CONTEXT.endDate}T00:00:00Z`), status: "PLANNED" } });
    if (season.start_date.toISOString().slice(0, 10) !== SEED_CONTEXT.startDate ||
        season.end_date.toISOString().slice(0, 10) !== SEED_CONTEXT.endDate || season.status !== "PLANNED") {
      throw new SeedConfigurationError("La temporada sintética existente no coincide con el fixture; no se sobrescribió.");
    }
    const categoryKey = { league_id: league.id, sport_id: sport.id, name: SEED_CONTEXT.categoryName };
    const category = await tx.categories.findUnique({ where: { league_id_sport_id_name: categoryKey } })
      ?? await tx.categories.create({ data: categoryKey });
    const ruleKey = { season_id: season.id, version_number: SEED_CONTEXT.ruleVersion };
    // Evitar UPDATE vacío: competition_rules audita toda escritura.
    const rule = await tx.competition_rules.findUnique({ where: { season_id_version_number: ruleKey } })
      ?? await tx.competition_rules.create({ data: { ...ruleKey, status: "DRAFT" } });
    if (rule.status !== "DRAFT" || rule.approved_by !== null || rule.approved_at !== null || rule.file_id !== null) {
      throw new SeedConfigurationError("El reglamento sintético existente ya cambió; no se sobrescribió.");
    }
    const seasonCategoryKey = { season_id: season.id, category_id: category.id };
    const seasonCategory = await tx.season_categories.findUnique({ where: { season_id_category_id: seasonCategoryKey } })
      ?? await tx.season_categories.create({ data: { ...seasonCategoryKey,
        competition_rule_id: rule.id, hierarchy_order: SEED_CONTEXT.hierarchyOrder,
        type: SEED_CONTEXT.categoryType, age_cutoff_date: new Date(`${SEED_CONTEXT.ageCutoffDate}T00:00:00Z`) } });
    if (seasonCategory.competition_rule_id !== rule.id || seasonCategory.type !== SEED_CONTEXT.categoryType ||
        seasonCategory.hierarchy_order !== SEED_CONTEXT.hierarchyOrder ||
        seasonCategory.age_cutoff_date.toISOString().slice(0, 10) !== SEED_CONTEXT.ageCutoffDate ||
        seasonCategory.minimum_age !== null || seasonCategory.maximum_age !== null) {
      throw new SeedConfigurationError("La categoría por temporada existente no coincide con el fixture; no se sobrescribió.");
    }
    const groupKey = { season_category_id: seasonCategory.id, name: SEED_CONTEXT.groupName };
    const group = await tx.groups.findUnique({ where: { season_category_id_name: groupKey } })
      ?? await tx.groups.create({ data: { ...groupKey, season_id: season.id } });
    return { league: league.id, season: season.id, category: category.id,
      rule: rule.id, seasonCategory: seasonCategory.id, group: group.id };
  }, { maxWait: 10_000, timeout: 30_000 });
}
