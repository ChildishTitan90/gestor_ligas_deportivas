import type { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { SEED_ACTOR } from "./seed-data";
import { DEMO_ACCOUNTS, DEMO_CONTEXT, DEMO_PASSWORD, LEGACY_DEMO_ACCOUNTS } from "./seed-demo-data";
import { validatePermissionCatalog } from "./permissions-catalog";
import { readSeedDatabaseUrl, SeedConfigurationError } from "./seed-env";
import { installPermissionCatalog } from "./seed-permissions";
import { seedBaseDatabase } from "./seed-runner";

export const DEMO_INSTALLATION = {
  id: "54000000-0000-4000-8000-000000000052",
  tableName: "seed_demo_profile",
  reason: "PDGLD-54: provisión inicial del perfil local DEMO",
} as const;

/** Solo el CLI/local harness proporciona el cliente y un destino local validado. */
export async function seedDemoDatabase(prisma: PrismaClient, input: unknown, environment = process.env) {
  readSeedDatabaseUrl(environment);
  const catalog = validatePermissionCatalog(input);
  // El KDF queda fuera de la transacción y mantiene el formato de autenticación.
  const hashOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
  const [passwordHash, legacyHash] = await Promise.all([
    argon2.hash(DEMO_PASSWORD, hashOptions), argon2.hash("Local-Demo-48!real-test", hashOptions),
  ]);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(47, 2026)::text`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(54, 2026)::text`;
    const previous = await tx.audit_logs.findUnique({ where: { id: DEMO_INSTALLATION.id } });
    if (previous) {
      if (previous.table_name !== DEMO_INSTALLATION.tableName || previous.action !== "INSTALL") {
        throw new SeedConfigurationError("El identificador reservado del perfil demo pertenece a otro evento; no se modificó.");
      }
      return { alreadyInstalled: true, createdAccounts: 0, installedMatrix: false };
    }
    await seedBaseDatabase(tx);
    const actor = await tx.users.findUniqueOrThrow({ where: { person_id: SEED_ACTOR.personId }, select: { id: true } });
    const matrix = await installPermissionCatalog(tx, catalog, actor.id);
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
      set_config('app.reason', ${DEMO_INSTALLATION.reason}, true)`;
    const sport = await tx.sports.findUniqueOrThrow({ where: { code: "SOCCER" }, select: { id: true } });
    // Crear, nunca adoptar por nombre ni sobrescribir contextos ajenos.
    for (const [id, name] of [[DEMO_CONTEXT.leagueId, DEMO_CONTEXT.leagueName],
      [DEMO_CONTEXT.otherLeagueId, DEMO_CONTEXT.otherLeagueName]] as const) {
      await tx.leagues.create({ data: { id, name } });
    }
    for (const [id, leagueId] of [[DEMO_CONTEXT.seasonId, DEMO_CONTEXT.leagueId],
      [DEMO_CONTEXT.otherSeasonId, DEMO_CONTEXT.otherLeagueId]] as const) {
      await tx.seasons.create({ data: { id, league_id: leagueId, sport_id: sport.id,
        name: DEMO_CONTEXT.seasonName, start_date: new Date("2026-01-01T00:00:00Z"),
        end_date: new Date("2026-12-31T00:00:00Z"), status: "PLANNED" } });
    }
    for (const [id, reference, name] of [[DEMO_CONTEXT.clubAId, "DEMO-54-CLUB-A", "DEMO Club A"],
      [DEMO_CONTEXT.clubBId, "DEMO-54-CLUB-B", "DEMO Club B"]] as const) {
      await tx.clubs.create({ data: { id, league_id: DEMO_CONTEXT.leagueId, reference_number: reference, name } });
    }
    let createdAccounts = 0;
    const startsAt = new Date();
    for (const account of DEMO_ACCOUNTS) {
      const role = await tx.roles.findUniqueOrThrow({ where: { code: account.roleCode }, select: { id: true } });
      const user = await tx.users.create({ data: {
        email: account.email, username: account.username, password_hash: passwordHash,
        is_active: account.active, must_change_password: account.temporary,
        people: { create: { id: account.personId, first_name: account.name, paternal_surname: "DEMO PDGLD-54" } },
      }, select: { id: true } });
      await tx.user_roles.create({ data: {
        user_id: user.id, role_id: role.id,
        delegate_position: "delegatePosition" in account ? account.delegatePosition : null,
        league_id: account.scope === "global" ? null : DEMO_CONTEXT.leagueId,
        club_id: account.scope === "clubA" ? DEMO_CONTEXT.clubAId : account.scope === "clubB" ? DEMO_CONTEXT.clubBId : null,
        starts_at: startsAt, ends_at: account.temporary ? new Date(startsAt.getTime() + 30 * 86_400_000) : null,
      } });
      createdAccounts++;
    }
    for (const [clubId, personId, reference] of [
      [DEMO_CONTEXT.clubAId, DEMO_ACCOUNTS[3].personId, "DEMO-54-AFFILIATION-A"],
      [DEMO_CONTEXT.clubBId, DEMO_ACCOUNTS[4].personId, "DEMO-54-AFFILIATION-B"],
    ] as const) {
      const requester = await tx.users.findUniqueOrThrow({ where: { person_id: personId }, select: { id: true } });
      await tx.club_affiliations.create({ data: {
        club_id: clubId, league_id: DEMO_CONTEXT.leagueId, season_id: DEMO_CONTEXT.seasonId,
        reference_number: reference, uniform_colors: "Azul y blanco DEMO", requested_by: requester.id,
        status: "PENDING",
      } });
    }
    for (const account of LEGACY_DEMO_ACCOUNTS) {
      const existing = await tx.users.findFirst({ where: { email: { equals: account.email, mode: "insensitive" } }, select: { id: true } });
      if (existing) continue;
      await tx.users.create({ data: {
        email: account.email, username: account.username, password_hash: legacyHash,
        must_change_password: account.mustChangePassword,
        people: { create: { first_name: "Cuenta de prueba", paternal_surname: "Local" } },
      } });
      createdAccounts++;
    }
    await tx.audit_logs.create({ data: { id: DEMO_INSTALLATION.id, user_id: actor.id,
      action: "INSTALL", table_name: DEMO_INSTALLATION.tableName, entity_id: DEMO_INSTALLATION.id,
      reason: DEMO_INSTALLATION.reason, new_data: { profile: "demo", createdAccounts } } });
    return { alreadyInstalled: false, createdAccounts, installedMatrix: matrix.installed };
  }, { maxWait: 10_000, timeout: 30_000 });
}
