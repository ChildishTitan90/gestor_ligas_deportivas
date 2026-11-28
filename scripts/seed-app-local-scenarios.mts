import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { getPrisma } from "../src/server/db/prisma";
import { readDevelopmentSeedDatabaseUrl } from "../prisma/seed-env";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
readDevelopmentSeedDatabaseUrl();
const db = getPrisma();
const marker = "77000000-0000-4000-8000-000000000177";
try {
  const message = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(77,175)::text`;
    if (await tx.audit_logs.findUnique({ where: { id: marker } })) return "Los escenarios locales ya existen. Se conservaron los cambios posteriores.";
    const league = await tx.leagues.findUniqueOrThrow({ where: { name: "Liga local de tesorería" } });
    const season = await tx.seasons.findFirstOrThrow({ where: { league_id: league.id, name: "Temporada local 2026–2027" } });
    const actor = await tx.users.findFirstOrThrow({ where: { username: "admin-local" } });
    const secretary = await tx.users.findFirstOrThrow({ where: { username: "consulta-local" } });
    await tx.$queryRaw`SELECT set_config('app.user_id',${actor.id},true),set_config('app.reason','Escenarios ficticios autorizados de módulos locales',true)`;
    const body = await tx.governing_bodies.create({ data: { league_id: league.id, name: "Comité local de pruebas" } });
    for (const [name, roleCode, username] of [["Secretaría", "SECRETARY", "consulta-local"], ["Tesorería", "TREASURER", "tesoreria-local"],
      ["Arbitraje", "REFEREE_MANAGER", "arbitraje-local"]]) {
      const role = await tx.roles.findUniqueOrThrow({ where: { code: roleCode } });
      const user = await tx.users.findFirstOrThrow({ where: { username } });
      const position = await tx.positions.create({ data: { governing_body_id: body.id, name: name + " local", role_id: role.id } });
      await tx.appointments.create({ data: { position_id: position.id, person_id: user.person_id, starts_at: new Date("2026-01-01"), ends_at: new Date("2027-12-31") } });
    }
    const pendingSeason = await tx.seasons.create({ data: { league_id: league.id, sport_id: season.sport_id, name: "Trámites locales pendientes",
      start_date: new Date("2026-01-01"), end_date: new Date("2027-12-31") } });
    const clubs = await tx.clubs.findMany({ where: { league_id: league.id }, orderBy: { reference_number: "asc" } });
    for (const [index, club] of clubs.slice(0, 4).entries()) {
      const assignments = await tx.user_roles.findFirstOrThrow({ where: { club_id: club.id, delegate_position: "PRIMARY" } });
      await tx.club_affiliations.create({ data: { league_id: league.id, season_id: pendingSeason.id, club_id: club.id,
        reference_number: "LOCAL-175-PEND-" + index, uniform_colors: "Rojo y blanco de prueba", requested_by: assignments.user_id,
        status: index === 3 ? "REJECTED" : "PENDING", ...(index === 3 ? { reviewed_by: secretary.id, reviewed_at: new Date(), review_reason: "Caso local de corrección: completar los documentos de afiliación." } : {}) } });
    }
    const venues = await tx.venues.findMany({ where: { league_id: league.id }, orderBy: { code: "asc" } });
    const opens = new Date(); opens.setUTCHours(0, 0, 0, 0);
    const closes = new Date(opens); closes.setUTCDate(closes.getUTCDate() + 60);
    for (const venue of venues) {
      await tx.venue_availability.create({ data: { venue_id: venue.id, starts_at: opens, ends_at: closes, type: "AVAILABLE", reason: "Ventana ficticia de pruebas locales" } });
    }
    const blockedStart = new Date(opens); blockedStart.setUTCDate(blockedStart.getUTCDate() + 2); blockedStart.setUTCHours(18);
    const blockedEnd = new Date(blockedStart); blockedEnd.setUTCHours(20);
    await tx.venue_availability.create({ data: { venue_id: venues[0].id, starts_at: blockedStart, ends_at: blockedEnd, type: "MAINTENANCE", reason: "Mantenimiento local de prueba" } });
    const referees = await tx.referees.findMany({ where: { club_season_referees: { some: { season_id: season.id } } }, select: { id: true } });
    for (const referee of referees) await tx.referee_availability.create({ data: { referee_id: referee.id, starts_at: opens, ends_at: closes, is_available: true } });
    const nextDay = new Date(opens); nextDay.setUTCDate(nextDay.getUTCDate() + 7);
    const lastDay = new Date(nextDay); lastDay.setUTCDate(lastDay.getUTCDate() + 6);
    const day = await tx.matchdays.create({ data: { season_id: season.id, number: 1, start_date: nextDay, end_date: lastDay } });
    const groups = await tx.groups.findMany({ where: { season_id: season.id }, orderBy: { name: "asc" } });
    for (const [groupIndex, group] of groups.entries()) {
      const teams = await tx.season_teams.findMany({ where: { group_id: group.id, season_id: season.id }, orderBy: { id: "asc" } });
      for (let pair = 0; pair + 1 < teams.length; pair += 2) await tx.matches.create({ data: {
        season_id: season.id, group_id: group.id, matchday_id: day.id,
        number: `LOCAL-175-P-${groupIndex + 1}-${pair / 2 + 1}`, home_team_id: teams[pair].id, away_team_id: teams[pair + 1].id,
        notes: "Partido local de prueba pendiente de programación y designación.",
      } });
    }
    const rule = await tx.competition_rules.findFirstOrThrow({ where: { season_id: season.id } });
    const type = await tx.sanction_types.findFirstOrThrow();
    await tx.regulation_articles.create({ data: { competition_rule_id: rule.id, number: "LOCAL-01",
      description: "Artículo ficticio editable para probar el catálogo. Requiere decisión de la Liga antes de uso oficial.",
      sanction_type_id: type.id, parameters: { pending: true, synthetic: true } } });
    // Estados de cuenta para probar denegación y cambio obligatorio sin tocar cuentas anteriores.
    for (const [username, active, temporary] of [["inactiva-local-175", false, false], ["temporal-local-175", true, true]] as const) {
      await tx.users.create({ data: { username, email: username + "@example.test", password_hash: actor.password_hash,
        is_active: active, must_change_password: temporary,
        people: { create: { first_name: "Cuenta de prueba", paternal_surname: temporary ? "Temporal" : "Inactiva" } } } });
    }
    await tx.audit_logs.create({ data: { id: marker, user_id: actor.id, action: "INSTALL", table_name: "seed_app_local_scenarios",
      reason: "Preparación de gobierno, trámites, disponibilidad, jornada, partidos y catálogo para revisión local",
      new_data: { fixtureHash: createHash("sha256").update("local-app-scenarios-v1").digest("hex") } } });
    return "Escenarios locales agregados: órganos y cargos, afiliaciones pendientes/rechazadas, disponibilidad, bloqueos, diez partidos en borrador, catálogo y cuentas restringidas.";
  }, { timeout: 60000 });
  console.log(message);
} catch (error) {
  const metadata = error && typeof error === "object" && "meta" in error ? error.meta as { driverAdapterError?: { cause?: { originalMessage?: string } } } : null;
  console.error("La preparación de escenarios se revirtió.", metadata?.driverAdapterError?.cause?.originalMessage ?? "Revisa las restricciones del escenario.");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
