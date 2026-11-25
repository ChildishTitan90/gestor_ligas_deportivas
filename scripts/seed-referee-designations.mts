import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import { readDevelopmentSeedDatabaseUrl } from "../prisma/seed-env";
import { DEMO_CONTEXT } from "../prisma/seed-demo-data";
import { getPrisma } from "../src/server/db/prisma";
import { assertPermission } from "../src/server/auth/authorization";
import { assessAssignment, authorizeRefereeing, ensurePresentingClub, lockRefereeing, mutateRefereeingInTransaction } from "../src/features/referees/server/service";

// Datos persistentes solicitados para el Docker habitual. Nunca instala otra BD,
// modifica cuentas/contraseñas/permisos ni restaura estados al repetir el comando.
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const leagueId = DEMO_CONTEXT.leagueId;
const seasonId = "33f8a69d-ed3c-5629-a464-6e9f440d8b42";
const seasonName = "DEMO Registro de jugadores 2026";
const prefix = "SINTÉTICO PDGLD-86";
function id(label: string) { const hex = createHash("sha256").update(`local-designation-flow:86:v1:${label}`).digest("hex"); return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`; }
const cases = [
  { number: "PR86-01", referee: "primary", day: "2026-11-28", start: "14:00", end: "16:00", pair: 0, venue: 0, expected: "PROPOSED", blocker: "" },
  { number: "PR86-02", referee: "primary", day: "2026-11-28", start: "17:00", end: "19:00", pair: 0, venue: 0, expected: "APPROVED", blocker: "" },
  { number: "PR86-03", referee: "primary", day: "2026-11-29", start: "14:00", end: "16:00", pair: 0, venue: 0, expected: "REVOKED", blocker: "" },
  { number: "PR86-04", referee: "inactive", day: "2026-11-29", start: "17:00", end: "19:00", pair: 0, venue: 0, expected: "PROPOSED", blocker: "INACTIVE" },
  { number: "PR86-05", referee: "unavailable", day: "2026-11-30", start: "14:00", end: "16:00", pair: 0, venue: 0, expected: "PROPOSED", blocker: "UNAVAILABLE" },
  { number: "PR86-06", referee: "primary", day: "2026-11-28", start: "17:00", end: "19:00", pair: 1, venue: 1, expected: "PROPOSED", blocker: "OVERLAP" },
  { number: "PR86-07", referee: "primary", day: "2026-11-30", start: "17:00", end: "19:00", pair: 2, venue: 0, expected: "PROPOSED", blocker: "CLUB_IN_GROUP" },
  { number: "PR86-08", referee: "uncovered", day: "2026-12-01", start: "14:00", end: "16:00", pair: 0, venue: 0, expected: "PROPOSED", blocker: "UNKNOWN_AVAILABILITY" },
] as const;
let stage = "target";
let db: ReturnType<typeof getPrisma> | undefined;
try {
  readDevelopmentSeedDatabaseUrl();
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    const target = new URL(process.env[key] ?? "");
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.port !== "5433" || target.pathname !== "/gestor_ligas_dev") throw Error("LOCAL_ONLY");
  }
  db = getPrisma();
  const result = await db.$transaction(async tx => {
    await lockRefereeing(tx);
    const [target] = await tx.$queryRaw<{ name: string; managed: boolean }[]>`SELECT current_database()::text AS name,to_regnamespace('auth') IS NOT NULL OR to_regnamespace('storage') IS NOT NULL AS managed`;
    if (target.name !== "gestor_ligas_dev" || target.managed) throw Error("LOCAL_ONLY");
    stage = "profile";
    const profile = await tx.audit_logs.findUnique({ where: { id: "54000000-0000-4000-8000-000000000052" }, select: { action: true, table_name: true } });
    if (profile?.action !== "INSTALL" || profile.table_name !== "seed_demo_profile") throw Error("DEMO_PROFILE_REQUIRED");
    const marker = await tx.audit_logs.findUnique({ where: { id: id("installed") }, select: { action: true, table_name: true } });
    if (marker) {
      if (marker.action !== "INSTALL" || marker.table_name !== "seed_referee_designations") throw Error("MARKER_CONFLICT");
      return { installed: false, seasonId, leagueId, matches: cases.map(c => c.number) };
    }
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId }, select: { league_id: true, name: true, status: true, sport_id: true, team_registration_closed_at: true } });
    if (season.league_id !== leagueId || season.name !== seasonName || season.status === "CLOSED" || season.team_registration_closed_at) throw Error("SELECTED_SEASON_NOT_OPEN");
    const actors: Record<string,string> = {};
    for (const username of ["demo-admin", "demo-programador", "arbitraje_comision", "arbitraje_arbitro"]) {
      const u = await tx.users.findFirst({ where: { username, is_active: true, must_change_password: false }, select: { id: true } });
      if (!u) throw Error("OPERATIONAL_DEMO_ACCOUNTS_REQUIRED"); actors[username] = u.id;
    }
    const admin = actors["demo-admin"], commission = actors.arbitraje_comision, scheduler = actors["demo-programador"];
    await assertPermission(tx, admin, { module: "competitions", action: "CREATE", context: { leagueId, seasonId } });
    await assertPermission(tx, admin, { module: "clubs", action: "CREATE", context: { leagueId, seasonId } });
    await authorizeRefereeing(tx, commission, "CREATE", leagueId, seasonId);
    await authorizeRefereeing(tx, commission, "APPROVE", leagueId, seasonId);
    await authorizeRefereeing(tx, scheduler, "UPDATE", leagueId, seasonId);
    if (await tx.categories.findUnique({ where: { id: id("category") }, select: { id: true } })) throw Error("UNMARKED_FIXTURE_EXISTS");
    await tx.$queryRaw`SELECT set_config('app.user_id',${admin},true),set_config('app.reason','PDGLD-86: registros SINTÉTICOS solicitados para entender designaciones en Docker local',true)`;
    stage = "competition-fixtures";
    const lastRule = await tx.competition_rules.findFirst({ where: { season_id: seasonId }, orderBy: { version_number: "desc" }, select: { version_number: true } });
    const rule = await tx.competition_rules.create({ data: { id: id("rule"), season_id: seasonId, version_number: (lastRule?.version_number ?? 0) + 1, status: "APPROVED", approved_by: admin, approved_at: new Date() }, select: { id: true } });
    const category = await tx.categories.create({ data: { id: id("category"), league_id: leagueId, sport_id: season.sport_id, name: `${prefix} · Designaciones` }, select: { id: true } });
    const sc = await tx.season_categories.create({ data: { id: id("season-category"), season_id: seasonId, category_id: category.id, competition_rule_id: rule.id, hierarchy_order: 86, type: "OPEN", competition_format: "GROUP_STAGE", age_cutoff_date: new Date("2026-12-31Z") }, select: { id: true } });
    const free = await tx.groups.create({ data: { id: id("free-group"), season_id: seasonId, season_category_id: sc.id, name: "SINTÉTICO · Sin club presentador" }, select: { id: true } });
    const conflict = await tx.groups.create({ data: { id: id("conflict-group"), season_id: seasonId, season_category_id: sc.id, name: "SINTÉTICO · Conflicto de club" }, select: { id: true } });
    const mainPerson = await tx.users.findUniqueOrThrow({ where: { id: actors.arbitraje_arbitro }, select: { person_id: true } });
    const knownReferee = await tx.referees.findUnique({ where: { person_id: mainPerson.person_id }, select: { id: true, is_active: true } });
    if (knownReferee && !knownReferee.is_active) throw Error("PRIMARY_REFEREE_INACTIVE");
    const knownLink = knownReferee ? await tx.club_season_referees.findUnique({ where: { referee_id_season_id: { referee_id: knownReferee.id, season_id: seasonId } }, select: { club_id: true } }) : null;
    const clubs: string[] = [];
    for (const [index, name] of ["Presentador", "Local", "Visitante"].entries()) {
      if (index === 0 && knownLink) { clubs.push(knownLink.club_id); continue; }
      const club = await tx.clubs.create({ data: { id: id(`club:${index}`), league_id: leagueId, name: `${prefix} · ${name}`, reference_number: `PR86-C${index}` }, select: { id: true } }); clubs.push(club.id);
      await tx.club_affiliations.create({ data: { club_id: club.id, season_id: seasonId, league_id: leagueId, reference_number: `PR86-A${index}`, uniform_colors: "Datos sintéticos", status: "APPROVED", requested_by: admin }, select: { id: true } });
    }
    const pairs: { id: string }[][] = [];
    for (let pair = 0; pair < 3; pair++) {
      pairs[pair] = [];
      for (let side = 0; side < 2; side++) {
        const team = await tx.teams.create({ data: { id: id(`team:${pair}:${side}`), club_id: clubs[side + 1], name: `${prefix} · ${side ? "Visitante" : "Local"} ${pair + 1}`, reference_number: `PR86-T${pair}${side}` }, select: { id: true } });
        const enrollment = await tx.season_teams.create({ data: { team_id: team.id, club_id: clubs[side + 1], season_id: seasonId, season_category_id: sc.id, status: "REGISTERED" }, select: { id: true } });
        await tx.season_teams.update({ where: { id: enrollment.id }, data: { group_id: pair === 2 ? conflict.id : free.id }, select: { id: true } }); pairs[pair].push(enrollment);
      }
    }
    const third = await tx.teams.create({ data: { club_id: clubs[0], name: `${prefix} · Tercero del club presentador`, reference_number: "PR86-T-P" }, select: { id: true } });
    const thirdEnrollment = await tx.season_teams.create({ data: { team_id: third.id, club_id: clubs[0], season_id: seasonId, season_category_id: sc.id, status: "REGISTERED" }, select: { id: true } });
    const venues: string[] = [];
    for (let v = 0; v < 2; v++) {
      const venue = await tx.venues.create({ data: { league_id: leagueId, code: `PR86-V${v}`, name: `${prefix} · Cancha ${v + 1}`, address: "Registro sintético, sin domicilio real", match_duration_minutes: 120 }, select: { id: true } }); venues.push(venue.id);
      await tx.venue_availability.create({ data: { venue_id: venue.id, starts_at: new Date("2026-11-28T00:00:00Z"), ends_at: new Date("2026-12-02T00:00:00Z"), type: "AVAILABLE" }, select: { id: true } });
    }
    stage = "referees-and-availability";
    const refs: Record<string,string> = {};
    for (const code of ["primary", "inactive", "unavailable", "uncovered"]) {
      const person = code === "primary" ? { id: mainPerson.person_id } : await tx.people.create({ data: { first_name: `SINTÉTICO ${code === "inactive" ? "Inactivo" : code === "unavailable" ? "No disponible" : "Sin cobertura"}`, paternal_surname: "PDGLD86" }, select: { id: true } });
      const referee = code === "primary" && knownReferee ? knownReferee : await tx.referees.create({ data: { person_id: person.id }, select: { id: true } }); refs[code] = referee.id;
      await ensurePresentingClub(tx, referee.id, clubs[0], seasonId);
      const version = await tx.referees.findUniqueOrThrow({ where: { id: referee.id }, select: { version: true } });
      await mutateRefereeingInTransaction(tx, commission, { kind: "availability", operationKey: id(`availability:${code}`), leagueId, seasonId, reason: `${prefix}: disponibilidad inicial para recorrer propuestas`, refereeId: referee.id, expectedVersion: version.version, startsAt: "2026-11-28T00:00:00.000Z", endsAt: "2026-12-02T00:00:00.000Z", available: true });
    }
    const scheduled = await tx.match_statuses.findUniqueOrThrow({ where: { code: "SCHEDULED" }, select: { id: true } });
    const lastDay = await tx.matchdays.findFirst({ where: { season_id: seasonId }, orderBy: { number: "desc" }, select: { number: true } });
    const days = new Map<string,string>();
    for (const day of [...new Set(cases.map(c => c.day))]) {
      const row = await tx.matchdays.create({ data: { season_id: seasonId, number: (lastDay?.number ?? 0) + days.size + 1, start_date: new Date(`${day}T00:00:00Z`), end_date: new Date(`${day}T00:00:00Z`) }, select: { id: true } }); days.set(day, row.id);
    }
    const assignments: Record<string,{id:string;version:number;matchId:string;matchVersion:number}> = {};
    stage = "proposals";
    for (const c of cases) {
      const match = await tx.matches.create({ data: { id: id(c.number), season_id: seasonId, group_id: c.pair === 2 ? conflict.id : free.id, matchday_id: days.get(c.day)!, number: c.number, home_team_id: pairs[c.pair][0].id, away_team_id: pairs[c.pair][1].id, venue_id: venues[c.venue], starts_at: new Date(`${c.day}T${c.start}:00Z`), ends_at: new Date(`${c.day}T${c.end}:00Z`), reserved_until: new Date(`${c.day}T${c.end}:00Z`), status_id: scheduled.id, notes: `${prefix}: ${c.blocker || c.expected}` }, select: { id: true, version: true } });
      const proposed = await mutateRefereeingInTransaction(tx, scheduler, { kind: "propose", operationKey: id(`propose:${c.number}`), leagueId, seasonId, reason: `${prefix}: propuesta inicialmente válida ${c.number}`, refereeId: refs[c.referee], matchId: match.id, expectedMatchVersion: match.version });
      assignments[c.number] = { ...proposed, matchId: match.id, matchVersion: match.version };
    }
    stage = "approval-and-revocation";
    for (const number of ["PR86-02", "PR86-03"]) {
      const a = assignments[number];
      const approved = await mutateRefereeingInTransaction(tx, commission, { kind: "approve", operationKey: id(`approve:${number}`), leagueId, seasonId, reason: `${prefix}: aprobación para explicar el acceso efectivo`, assignmentId: a.id, expectedVersion: a.version, expectedMatchVersion: a.matchVersion });
      if (number === "PR86-03") await mutateRefereeingInTransaction(tx, commission, { kind: "revoke", operationKey: id(`revoke:${number}`), leagueId, seasonId, reason: `${prefix}: revocación para conservar el antecedente sin acceso`, assignmentId: a.id, expectedVersion: approved.version, expectedMatchVersion: a.matchVersion });
    }
    stage = "subsequent-blockers";
    const inactive = await tx.referees.findUniqueOrThrow({ where: { id: refs.inactive }, select: { person_id: true, version: true } });
    await mutateRefereeingInTransaction(tx, commission, { kind: "register", operationKey: id("deactivate"), leagueId, seasonId, reason: `${prefix}: árbitro desactivado después de proponerlo`, personId: inactive.person_id, clubId: clubs[0], active: false, expectedVersion: inactive.version });
    const unavailable = await tx.referees.findUniqueOrThrow({ where: { id: refs.unavailable }, select: { version: true } });
    await mutateRefereeingInTransaction(tx, commission, { kind: "availability", operationKey: id("blackout"), leagueId, seasonId, reason: `${prefix}: horario no disponible declarado después de la propuesta`, refereeId: refs.unavailable, expectedVersion: unavailable.version, startsAt: "2026-11-30T14:00:00.000Z", endsAt: "2026-11-30T16:00:00.000Z", available: false });
    const uncovered = await tx.referees.findUniqueOrThrow({ where: { id: refs.uncovered }, select: { version: true } });
    const initialInterval = await tx.referee_availability.findFirstOrThrow({ where: { referee_id: refs.uncovered }, select: { id: true } });
    await mutateRefereeingInTransaction(tx, commission, { kind: "availability", operationKey: id("uncovered"), leagueId, seasonId, reason: `${prefix}: disponibilidad movida fuera del partido propuesto`, refereeId: refs.uncovered, expectedVersion: uncovered.version, intervalId: initialInterval.id, startsAt: "2026-12-03T14:00:00.000Z", endsAt: "2026-12-03T16:00:00.000Z", available: true });
    await tx.$queryRaw`SELECT set_config('app.user_id',${admin},true),set_config('app.reason','PDGLD-86: tercero SINTÉTICO del club presentador incorporado al grupo tras la propuesta',true)`;
    await tx.season_teams.update({ where: { id: thirdEnrollment.id }, data: { group_id: conflict.id }, select: { id: true } });
    stage = "validate-cases";
    for (const c of cases) {
      const a = assignments[c.number], actual = await tx.referee_assignments.findUniqueOrThrow({ where: { id: a.id }, select: { status: true } });
      assert.equal(actual.status, c.expected);
      const assessment = await assessAssignment(tx, a.matchId, refs[c.referee], a.id);
      if (c.blocker) assert.ok(assessment.blockers.some(b => b.code === c.blocker), c.number);
      else if (c.expected !== "REVOKED") assert.equal(assessment.blockers.length, 0, c.number);
    }
    await tx.audit_logs.create({ data: { id: id("installed"), user_id: admin, action: "INSTALL", table_name: "seed_referee_designations", entity_id: seasonId, reason: "PDGLD-86: ocho casos SINTÉTICOS solicitados en la temporada DEMO existente de Docker", new_data: { leagueId, seasonId, prefix, matches: cases.map(c => c.number), primaryUsername: "arbitraje_arbitro", source: "scripts/seed-referee-designations.mts" } } });
    return { installed: true, seasonId, leagueId, matches: cases.map(c => c.number) };
  }, { timeout: 30000 });
  console.log(JSON.stringify({ ...result, season: seasonName, url: `/referees?league=${leagueId}&season=${seasonId}&view=assignments`, existingRefereeAccount: "arbitraje_arbitro", newAccounts: 0 }));
} catch (error) {
  console.error(JSON.stringify({ code: "LOCAL_DESIGNATION_SEED_FAILED", stage, name: error instanceof Error ? error.name : "unknown", domainCode: error instanceof Error && "code" in error ? error.code : undefined })); process.exitCode = 1;
} finally { await db?.$disconnect(); }
