import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { getPrisma } from "../src/server/db/prisma";
import { readDevelopmentSeedDatabaseUrl } from "../prisma/seed-env";
import { generateScheduleForActor } from "../src/features/scheduling/server/service";
import { calculateStandingsInTransaction } from "../src/features/standings/server/service";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
readDevelopmentSeedDatabaseUrl();
const db = getPrisma();
const marker = "77000000-0000-4000-8000-000000000178";
function key(value: string) {
  const h = createHash("sha256").update("LOCAL175-COMPETITION:" + value).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
try {
  await db.$transaction(async tx => {
    if (await tx.audit_logs.findUnique({ where: { id: marker } })) return;
    const league = await tx.leagues.findUniqueOrThrow({ where: { name: "Liga local de tesorería" } });
    const original = await tx.seasons.findFirstOrThrow({ where: { league_id: league.id, name: "Temporada local 2026–2027" } });
    const admin = await tx.users.findFirstOrThrow({ where: { username: "admin-local" } });
    await tx.$queryRaw`SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Reglas ficticias explícitas para escenarios locales, sin valor reglamentario',true)`;
    const venues = await tx.venues.findMany({ where: { league_id: league.id }, select: { id: true } });
    const parameters = {
      announcement: "Escenario local ficticio para pruebas. Valores de ejemplo sin aprobación de Liga.",
      points: { win: 3, draw: 1, loss: 0 },
      tieBreakers: ["POINTS", "GOAL_DIFFERENCE", "GOALS_FOR", "WINS"],
      calendar: { rounds: 1, matchDurationMinutes: 90, scheduling: { slotStepMinutes: 30,
        venueStages: [{ fromRound: 1, toRound: 9, venueIds: venues.map(venue => venue.id) }] } },
    };
    const newSeason = await tx.seasons.create({ data: { id: key("season"), league_id: league.id, sport_id: original.sport_id,
      name: "Calendario local por revisar", start_date: new Date("2026-01-01"), end_date: new Date("2027-12-31") } });
    for (const season of [original, newSeason]) {
      const rule = await tx.competition_rules.create({ data: { season_id: season.id, version_number: season.id === original.id ? 2 : 1 } });
      for (const [name, value] of Object.entries(parameters)) await tx.competition_rule_parameters.create({ data: {
        competition_rule_id: rule.id, parameter_key: name, parameter_value: value, requires_validation: false, validated_by: admin.id,
      } });
      await tx.competition_rules.update({ where: { id: rule.id }, data: { status: "APPROVED", approved_by: admin.id, approved_at: new Date() } });
      if (season.id === original.id) {
        await tx.season_categories.updateMany({ where: { season_id: season.id }, data: { competition_rule_id: rule.id } });
      } else {
        const source = await tx.season_categories.findFirstOrThrow({ where: { season_id: original.id } });
        const category = await tx.season_categories.create({ data: { season_id: season.id, category_id: source.category_id,
          competition_rule_id: rule.id, hierarchy_order: 1, type: "OPEN", age_cutoff_date: source.age_cutoff_date, competition_format: "GROUP_STAGE" } });
        const groups = [];
        for (const name of ["Grupo A", "Grupo B"]) groups.push(await tx.groups.create({ data: { season_id: season.id, season_category_id: category.id, name } }));
        const memberships = await tx.season_teams.findMany({ where: { season_id: original.id }, orderBy: { team_id: "asc" } });
        for (const [index, team] of memberships.entries()) {
          await tx.club_affiliations.create({ data: { club_id: team.club_id, league_id: league.id, season_id: season.id,
            reference_number: "LOCAL-175-CAL-AF-" + index, uniform_colors: "Uniforme ficticio local", requested_by: admin.id,
            status: "APPROVED", reviewed_by: admin.id, reviewed_at: new Date(), review_reason: "Afiliación ficticia del escenario de calendario." } });
          await tx.club_affiliation_categories.create({ data: { affiliation_id: (await tx.club_affiliations.findUniqueOrThrow({
            where: { club_id_season_id: { club_id: team.club_id, season_id: season.id } } })).id,
            season_id: season.id, category_id: source.category_id, authorized_by: admin.id, authorized_at: new Date() } });
          const enrollment = await tx.season_teams.create({ data: { season_id: season.id, team_id: team.team_id, club_id: team.club_id,
            season_category_id: category.id } });
          await tx.season_teams.update({ where: { id: enrollment.id }, data: { group_id: groups[index < 10 ? 0 : 1].id } });
        }
        for (let number = 1; number <= 9; number++) {
          const start = new Date(); start.setUTCHours(0,0,0,0); start.setUTCDate(start.getUTCDate() + 7 * number);
          const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
          await tx.matchdays.create({ data: { season_id: season.id, number, start_date: start, end_date: end } });
        }
      }
    }
    const end = new Date(); end.setUTCDate(end.getUTCDate() + 180);
    await tx.venue_availability.updateMany({ where: { venue_id: { in: venues.map(venue => venue.id) }, reason: "Ventana ficticia de pruebas locales" }, data: { ends_at: end } });
    await tx.audit_logs.create({ data: { id: marker, user_id: admin.id, action: "INSTALL", table_name: "seed_local_competition",
      reason: "Escenarios ficticios de reglas aprobadas, programación y clasificación sin resultados." } });
  }, { timeout: 30000 });
  const scheduler = await db.users.findFirstOrThrow({ where: { username: "programador-local" }, select: { id: true } });
  const season = await db.seasons.findUniqueOrThrow({ where: { id: key("season") } });
  for (const group of await db.groups.findMany({ where: { season_id: season.id } })) {
    await generateScheduleForActor(scheduler.id, { seasonId: season.id, categoryId: group.season_category_id, groupId: group.id,
      expectedSeasonVersion: season.version, operationId: key(group.id), reason: "Propuesta local ficticia para revisión manual", allowPending: true });
  }
  const admin = await db.users.findFirstOrThrow({ where: { username: "admin-local" }, select: { id: true } });
  const original = await db.seasons.findFirstOrThrow({ where: { name: "Temporada local 2026–2027", leagues: { name: "Liga local de tesorería" } } });
  const matchday = await db.matchdays.findFirstOrThrow({ where: { season_id: original.id } });
  for (const group of await db.groups.findMany({ where: { season_id: original.id } }))
    await db.$transaction(tx => calculateStandingsInTransaction(tx, admin.id, { groupId: group.id, matchdayId: matchday.id }), { isolationLevel: "Serializable", timeout: 30000 });
  console.log("Propuestas de calendario generadas por el servicio real y clasificación inicial preparada. Los resultados siguen pendientes de captura humana.");
} catch (error) {
  console.error("Escenario de competencia pendiente.", error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message : "Revisa los requisitos del escenario.");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
