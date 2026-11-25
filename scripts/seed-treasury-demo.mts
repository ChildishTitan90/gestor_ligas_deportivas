import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readDevelopmentSeedDatabaseUrl } from "../prisma/seed-env";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const connectionString = readDevelopmentSeedDatabaseUrl();
const marker = "77000000-0000-4000-8000-000000000175";
const password = (await readFile("docs/authentication.md", "utf8")).match(/`(Local-Demo-48[^\s`]+)`/)?.[1];
if (!password) throw new Error("Falta la contraseña sintética documentada.");
const hash = await argon2.hash(password);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const clubs = [
  "Monarcas Morelia", "Real Madrid", "Pumas", "Chivas", "Barcelona",
  "América", "Cruz Azul", "Tigres", "Toluca", "Atlas", "Pachuca", "León",
  "Liverpool", "Manchester City", "Bayern Múnich", "Juventus", "Inter de Milán",
  "Boca Juniors", "River Plate", "Santos Laguna",
];
const stadiums = ["Estadio Morelos", "Santiago Bernabéu", "Camp Nou", "Estadio Olímpico Universitario", "Estadio Akron", "Estadio Azteca"];
function id(key: string) {
  const digest = createHash("sha256").update("PDGLD175-LOCAL:" + key).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
try {
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(77,175)::text`;
    if (await tx.audit_logs.findUnique({ where: { id: marker }, select: { id: true } }))
      return "La carga local ya existe. Se conservaron los datos y cambios posteriores.";
    const treasurerRole = await tx.roles.findUniqueOrThrow({ where: { code: "TREASURER" } });
    const grants = await tx.role_permissions.count({ where: { role_id: treasurerRole.id, permissions: { module: "billing", action: { in: ["READ", "CREATE", "UPDATE"] } } } });
    if (grants !== 3) throw new Error("La matriz vigente requiere las capacidades de Cobranza de Tesorería.");
    const league = await tx.leagues.create({ data: { id: id("league"), name: "Liga local de tesorería" } });
    const actors = new Map<string, string>();
    for (const [username, roleCode] of [["tesoreria-local", "TREASURER"], ["consulta-local", "SECRETARY"], ["disciplina-local", "DISCIPLINARY_BOARD"],
      ["arbitraje-local", "REFEREE_MANAGER"], ["programador-local", "SCHEDULER"], ["capturista-local-175", "DATA_ENTRY"], ["admin-local", "SUPERADMIN"]]) {
      const role = await tx.roles.findUniqueOrThrow({ where: { code: roleCode } });
      const user = await tx.users.create({ data: { id: id(username), username, email: username + "@example.test", password_hash: hash, must_change_password: false,
        people: { create: { first_name: "Cuenta local", paternal_surname: roleCode } } }, select: { id: true } });
      actors.set(username, user.id);
      await tx.$queryRaw`SELECT set_config('app.user_id',${user.id},true),set_config('app.reason','Preparación local autorizada PDGLD-175',true)`;
      await tx.user_roles.create({ data: { user_id: user.id, role_id: role.id, league_id: roleCode === "SUPERADMIN" ? null : league.id } });
    }
    const actorId = actors.get("tesoreria-local")!;
    const secretaryId = actors.get("consulta-local")!;
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason','Datos ficticios locales para revisión manual PDGLD-175',true)`;
    const sport = await tx.sports.findUniqueOrThrow({ where: { code: "SOCCER" } });
    const season = await tx.seasons.create({ data: { id: id("season"), league_id: league.id, sport_id: sport.id, name: "Temporada local 2026–2027",
      start_date: new Date("2026-01-01"), end_date: new Date("2027-12-31") } });
    const rule = await tx.competition_rules.create({ data: { id: id("rules"), season_id: season.id, version_number: 1, status: "DRAFT" } });
    const category = await tx.categories.create({ data: { league_id: league.id, sport_id: sport.id, name: "Libre local" } });
    const participation = await tx.season_categories.create({ data: { season_id: season.id, category_id: category.id, competition_rule_id: rule.id, hierarchy_order: 1, type: "OPEN", age_cutoff_date: new Date("2026-01-01"),
      player_policy: { referenceYear: 2026, minimumAge: 18, maximumAge: null, exceptionMinimumAge: null, registrationDays: [1,2,3,4,5,6,7],
        timezone: "America/Mexico_City", playersOnField: 11, maximumCalledUp: 22, maximumRoster: null,
        documents: { version: 1, profile: "GENERAL", status: "APPROVED", pendingDecisions: [], activation: "ADMINISTRATIVE", requirements: [
          { key: "CURP", audience: "ALL", anyOf: ["CURP"], quantity: 1, requiredForDossier: true, requiredForEligibility: true },
          { key: "PLAYER_PHOTO", audience: "ALL", anyOf: ["PHOTO"], quantity: 1, requiredForDossier: false, requiredForEligibility: false },
          { key: "PHOTO_IDENTIFICATION", audience: "ALL", anyOf: ["INE"], quantity: 1, requiredForDossier: true, requiredForEligibility: true },
        ] } } } });
    const groups = [];
    for (const name of ["Grupo A", "Grupo B"]) groups.push(await tx.groups.create({ data: { season_id: season.id, season_category_id: participation.id, name } }));
    for (const [index, name] of clubs.entries()) {
      const club = await tx.clubs.create({ data: { id: id("club-" + index), league_id: league.id, name, reference_number: "LOCAL-175-C-" + (index + 1) } });
      const delegate = await tx.users.create({ data: { username: `delegado-local-${String(index + 1).padStart(2, "0")}`,
        email: `delegado-local-${index + 1}@example.test`, password_hash: hash, must_change_password: false,
        people: { create: { first_name: "Delegado local", paternal_surname: name } } } });
      const delegateRole = await tx.roles.findUniqueOrThrow({ where: { code: "CLUB_DELEGATE" } });
      await tx.user_roles.create({ data: { user_id: delegate.id, role_id: delegateRole.id, league_id: league.id,
        club_id: club.id, delegate_position: "PRIMARY" } });
      const affiliation = await tx.club_affiliations.create({ data: { club_id: club.id, league_id: league.id, season_id: season.id,
        reference_number: "LOCAL-175-AF-" + (index + 1), uniform_colors: "Uniforme local de prueba", requested_by: actorId, status: "APPROVED",
        reviewed_by: secretaryId, reviewed_at: new Date(), review_reason: "Afiliación ficticia preparada para revisión manual local." } });
      await tx.club_affiliation_categories.create({ data: { affiliation_id: affiliation.id, season_id: season.id, category_id: category.id,
        authorized_by: secretaryId, authorized_at: new Date() } });
      const team = await tx.teams.create({ data: { club_id: club.id, reference_number: "LOCAL-175-T-" + (index + 1), name } });
      const membership = await tx.season_teams.create({ data: { season_id: season.id, club_id: club.id, team_id: team.id,
        season_category_id: participation.id, group_id: groups[index < 10 ? 0 : 1].id } });
      if (index >= 5) await tx.referee_presentations.create({ data: { season_id: season.id, club_id: club.id,
        requester_id: delegate.id, operation_key: id("presentation-" + index), input_hash: createHash("sha256").update("LOCAL-175-PRESENTATION-" + index).digest("hex"),
        first_name: "Candidato " + (index + 1), paternal_surname: "Arbitral de prueba", reason: "Propuesta pendiente del club para revisión manual local." } });
      for (let number = 1; number <= 11; number++) {
        const person = await tx.people.create({ data: {
          first_name: ["Javier", "Diego", "Luis", "Miguel", "Carlos", "Andrés", "Pedro", "Daniel", "Hugo", "Raúl", "Óscar"][number - 1],
          paternal_surname: "Prueba", maternal_surname: `${index + 1}-${number}`, birth_date: new Date("2000-01-01"),
          curp: "PAJA000101HMNRRV" + String.fromCharCode(65 + Math.floor((index * 11 + number - 1) / 10)) + ((index * 11 + number - 1) % 10),
        }, select: { id: true } });
        await tx.player_registrations.create({ data: { season_id: season.id, season_team_id: membership.id,
          reference_number: `LOCAL-175-J-${index + 1}-${number}`, jersey_number: number, status: "INELIGIBLE",
          person_id: person.id, identity_review_status: "REQUIRED" } });
      }
    }
    const refereeRole = await tx.roles.findUniqueOrThrow({ where: { code: "REFEREE" } });
    for (let number = 1; number <= 5; number++) {
      const user = await tx.users.create({ data: { username: "arbitro-local-" + number, email: `arbitro-local-${number}@example.test`,
        password_hash: hash, must_change_password: false,
        people: { create: { first_name: ["Alejandro", "Roberto", "Mariana", "Lucía", "Fernando"][number - 1], paternal_surname: "Árbitro de prueba", birth_date: new Date("1990-01-01") } } },
        select: { id: true, person_id: true } });
      await tx.user_roles.create({ data: { user_id: user.id, role_id: refereeRole.id, league_id: league.id } });
      const referee = await tx.referees.create({ data: { person_id: user.person_id } });
      await tx.club_season_referees.create({ data: { referee_id: referee.id, season_id: season.id, club_id: id("club-" + (number - 1)) } });
    }
    for (const [index, name] of stadiums.entries()) await tx.venues.create({ data: { league_id: league.id,
      code: "LOCAL-175-V-" + (index + 1), name, address: "Ubicación ficticia para pruebas locales", is_league_sports_complex: true } });
    await tx.audit_logs.create({ data: { id: marker, user_id: actorId, action: "INSTALL", table_name: "seed_treasury_local",
      reason: "Carga local de clubes, jugadores, árbitros y canchas solicitada por el usuario",
      new_data: { clubs: clubs.length, teams: clubs.length, players: clubs.length * 11, referees: 5, venues: stadiums.length } } });
    return "Docker local preparado con 20 clubes, 20 equipos, 220 jugadores, 5 árbitros y 6 canchas. Los jugadores conservan la habilitación pendiente.";
  }, { timeout: 60000 });
  console.log(result);
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  console.error("No se completó la carga local. La transacción se revierte.", /^[A-Z0-9_]{3,30}$/.test(code) ? code : "VALIDATION");
  if (error && typeof error === "object" && "meta" in error) {
    const meta = error.meta as { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } };
    const cause = meta?.driverAdapterError?.cause;
    if (cause) console.error(cause.originalCode, cause.originalMessage?.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[conexión omitida]"));
  }
  process.exitCode = 1;
} finally { await db.$disconnect(); }
