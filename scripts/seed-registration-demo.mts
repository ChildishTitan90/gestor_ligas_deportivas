import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import nextEnv from "@next/env";
import pg from "pg";
import { readDevelopmentSeedDatabaseUrl } from "../prisma/seed-env";
import { DEMO_CONTEXT, DEMO_ACCOUNTS } from "../prisma/seed-demo-data";
import { getPrisma } from "../src/server/db/prisma";

// Complementa exclusivamente el perfil DEMO ya instalado. Nunca crea cuentas ni permisos.
const root = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);
nextEnv.loadEnvConfig(fileURLToPath(root), true, { info() {}, error() {} });
function id(label: string) {
  const hex = createHash("sha256").update(`local-registration-demo:v1:${label}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const marker = id("installed");
const reason = "PDGLD-98: datos sintéticos locales para afiliación, equipos y jugadores";
let db: ReturnType<typeof getPrisma> | undefined;
let guard: pg.Client | undefined;
let stage = "configuración local";
try {
  const url = new URL(readDevelopmentSeedDatabaseUrl());
  if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL es obligatoria.");
  url.search = "";
  guard = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
  stage = "conexión Docker";
  await guard.connect();
  const safety = await guard.query(`SELECT current_database() AS name,
    to_regnamespace('auth') IS NOT NULL OR to_regnamespace('storage') IS NOT NULL AS managed,
    EXISTS(SELECT FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS api_roles`);
  stage = "guardas Docker";
  if (safety.rows[0].name !== "gestor_ligas_dev" || safety.rows[0].managed || safety.rows[0].api_roles)
    throw new Error("Destino no compatible con la demostración Docker.");
  const profile = await guard.query(`SELECT 1 FROM sports_management.audit_logs
    WHERE id='54000000-0000-4000-8000-000000000052' AND table_name='seed_demo_profile' AND action='INSTALL'`);
  stage = "perfil DEMO existente";
  if (!profile.rowCount) throw new Error("Primero instala el perfil DEMO local.");
  await guard.end(); guard = undefined;
  // Las herramientas no imprimen la configuración privada ni los errores SQL.
  for (const args of [["migrate", "deploy"], ["generate"]]) {
    stage = args.join(" ");
    const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), ...args], {
      cwd: root, env: process.env, stdio: "pipe", windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error("No fue posible preparar las migraciones locales.");
  }
  db = getPrisma();
  stage = "transacción de datos DEMO";
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(98,2026)::text`;
    const existing = await tx.audit_logs.findUnique({ where: { id: marker } });
    if (existing) {
      if (existing.table_name !== "seed_registration_demo" || existing.action !== "INSTALL") throw new Error("Identificador ocupado.");
      return "Los datos de registro DEMO ya estaban instalados; se conservaron los cambios posteriores.";
    }
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: DEMO_CONTEXT.seasonId } });
    if (season.league_id !== DEMO_CONTEXT.leagueId || !season.name.startsWith("DEMO")) throw new Error("Contexto DEMO incompatible.");
    const secretary = await tx.users.findUniqueOrThrow({ where: { person_id: DEMO_ACCOUNTS[1].personId }, select: { id: true } });
    await tx.$queryRaw`SELECT set_config('app.user_id',${secretary.id},true),set_config('app.reason',${reason},true)`;
    const readySeason = await tx.seasons.create({ data: { id: id("ready-season"), league_id: season.league_id,
      sport_id: season.sport_id, name: "DEMO Registro de jugadores 2026", start_date: season.start_date,
      end_date: season.end_date, status: "PLANNED" } });
    const categories = [];
    for (const [code, name] of [["OPEN", "DEMO Libre"], ["VETERANS", "DEMO Veteranos (35+, prueba)"]] as const) {
      categories.push(await tx.categories.create({ data: { id: id(`category-${code}`), league_id: season.league_id, sport_id: season.sport_id, name } }));
    }
    const groups: string[] = [];
    for (const current of [season, readySeason]) {
      const rule = await tx.competition_rules.create({ data: { id: id(`rule-${current.id}`), season_id: current.id,
        version_number: 98, status: "DRAFT" } });
      for (const [index, category] of categories.entries()) {
        const categorySeason = await tx.season_categories.create({ data: { id: id(`sc-${current.id}-${index}`),
          season_id: current.id, category_id: category.id, competition_rule_id: rule.id,
          hierarchy_order: index + 1, type: index ? "VETERANS" : "OPEN", minimum_age: index ? 35 : null,
          age_cutoff_date: current.start_date } });
        const group = await tx.groups.create({ data: { id: id(`group-${current.id}-${index}`), season_id: current.id,
          season_category_id: categorySeason.id, name: `DEMO Grupo ${index + 1}` } });
        if (current.id === readySeason.id) groups.push(group.id);
      }
    }
    for (const [clubIndex, clubId] of [DEMO_CONTEXT.clubAId, DEMO_CONTEXT.clubBId].entries()) {
      const club = await tx.clubs.findUniqueOrThrow({ where: { id: clubId } });
      if (club.league_id !== season.league_id || !club.reference_number.startsWith("DEMO-54-")) throw new Error("Club DEMO incompatible.");
      const actor = await tx.users.findUniqueOrThrow({ where: { person_id: DEMO_ACCOUNTS[clubIndex + 3].personId }, select: { id: true } });
      const affiliation = await tx.club_affiliations.create({ data: { id: id(`affiliation-${clubIndex}`),
        club_id: clubId, league_id: season.league_id, season_id: readySeason.id,
        reference_number: `DEMO-98-AFF-${clubIndex + 1}`, uniform_colors: "Azul y blanco DEMO",
        requested_by: actor.id, status: "APPROVED", reviewed_by: secretary.id, reviewed_at: new Date(),
        review_reason: "Expediente sintético local preaprobado para probar el registro; no representa afiliación oficial." } });
      for (const [index, category] of categories.entries()) {
        await tx.club_affiliation_categories.create({ data: { affiliation_id: affiliation.id,
          season_id: readySeason.id, category_id: category.id, authorized_by: secretary.id, authorized_at: new Date() } });
        const team = await tx.teams.create({ data: { id: id(`team-${clubIndex}-${index}`), club_id: clubId,
          reference_number: `DEMO-98-TEAM-${clubIndex + 1}-${index + 1}`,
          name: `DEMO ${clubIndex ? "B" : "A"} ${index ? "Veteranos" : "Libre"}` } });
        await tx.season_teams.create({ data: { id: id(`enrolled-${clubIndex}-${index}`), season_id: readySeason.id,
          club_id: clubId, team_id: team.id, group_id: groups[index], enrolled_by: actor.id, enrolled_at: new Date(),
          enrollment_key: id(`enrollment-key-${clubIndex}-${index}`),
          enrollment_hash: createHash("sha256").update(`synthetic-local-team:${team.id}`).digest("hex") } });
      }
    }
    await tx.audit_logs.create({ data: { id: marker, user_id: secretary.id, action: "INSTALL", table_name: "seed_registration_demo",
      entity_id: marker, reason, new_data: { categories: 2, configuredSeasons: 2, groups: 4, readyTeams: 4 } } });
    return "Docker listo: 2 categorías, 4 grupos y 4 equipos de prueba. Las solicitudes anteriores se conservaron.";
  }, { timeout: 30000 });
  console.log(result);
} catch (error) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{5,30}$/.test(error.code) ? ` (${error.code})` : "";
  console.error(`No se completó la preparación DEMO: ${stage}${code}. No se imprimen conexiones ni errores SQL privados.`);
  process.exitCode = 1;
} finally {
  await guard?.end();
  await db?.$disconnect();
}
