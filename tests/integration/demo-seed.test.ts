import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import pg from "pg";
import { DEMO_ACCOUNTS, DEMO_CONTEXT, DEMO_PASSWORD } from "../../prisma/seed-demo-data";
import { DEMO_INSTALLATION, seedDemoDatabase } from "../../prisma/seed-demo";
import { MATRIX_INSTALLATION, installPermissionCatalog, seedPermissionDatabase } from "../../prisma/seed-permissions";
import { SEED_ACTOR, SEED_ROLES } from "../../prisma/seed-data";
import { readDevelopmentSeedDatabaseUrl, readSeedDatabaseUrl, readSeedProfile, SeedConfigurationError } from "../../prisma/seed-env";
import { loadPermissionCatalog, validatePermissionCatalog } from "../../prisma/permissions-catalog";
import { INITIAL_PERMISSION_GRANTS, PERMISSION_ROLE_CODES } from "../../prisma/permissions-data";

// Fixture deliberadamente aislado. No reproduce ni sustituye la matriz RF22.
const catalog = [
  { roleCode: "SUPERADMIN", module: "fixture_seed_demo", action: "UPDATE", contextOnly: false, ersReference: "FIXTURE PDGLD-54, no RF22" },
  { roleCode: "SECRETARY", module: "fixture_seed_demo", action: "READ", contextOnly: true, ersReference: "FIXTURE PDGLD-54, no RF22" },
  { roleCode: "CLUB_DELEGATE", module: "fixture_seed_demo", action: "READ", contextOnly: true, ersReference: "FIXTURE PDGLD-54, no RF22" },
];

function target() {
  assert.equal(process.env.SEED_TEST_DATABASE, "gestor_ligas_ci", "Usar el harness de seed con PostgreSQL desechable.");
  const url = new URL(readSeedDatabaseUrl());
  assert.equal(url.pathname, "/gestor_ligas_ci");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.ok(url.port);
  return url.href;
}

async function snapshot(client: pg.Client) {
  const tables = ["roles", "permissions", "role_permissions", "user_roles", "users", "people", "clubs", "club_affiliations", "leagues", "seasons", "audit_logs"];
  const state: Record<string, unknown> = {};
  for (const table of tables) {
    const { rows } = await client.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) AS records FROM sports_management.${table} AS t`);
    state[table] = rows[0].records;
  }
  return state;
}

test("perfiles: guardas locales, contrato PDGLD-55 y selección explícita", async () => {
  const url = "postgresql://postgres:synthetic-only@127.0.0.1:5432/gestor_ligas_dev";
  assert.equal(readSeedProfile([]), "base");
  assert.equal(readSeedProfile(["--profile", "demo"]), "demo");
  assert.equal(readSeedProfile(["--profile", "permissions"]), "permissions");
  assert.throws(() => readSeedProfile(["--profile", "unknown"]));
  assert.throws(() => readSeedDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: url }));
  assert.throws(() => readDevelopmentSeedDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: url.replace("127.0.0.1", "db.example.test") }));
  assert.throws(() => readDevelopmentSeedDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: url.replace("gestor_ligas_dev", "otra_base") }));
  assert.throws(() => readDevelopmentSeedDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: `${url}?host=db.example.test` }));
  assert.equal(readDevelopmentSeedDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: url }), url);
  assert.deepEqual(validatePermissionCatalog(catalog), catalog);
  assert.throws(() => validatePermissionCatalog([]));
  assert.throws(() => validatePermissionCatalog([catalog[0], catalog[0]]));
  assert.throws(() => validatePermissionCatalog([{ ...catalog[0], roleCode: "ADMIN" }]));
  assert.throws(() => validatePermissionCatalog([{ ...catalog[0], action: "DELETE" }]));
  assert.throws(() => validatePermissionCatalog([{ ...catalog[0], contextOnly: "false" }]));
  assert.throws(() => validatePermissionCatalog([{ ...catalog[0], ersReference: "" }]));
});

test("el cargador consume INITIAL_PERMISSION_GRANTS aprobado, sin aliases ni concesiones añadidas", async () => {
  const approved = await loadPermissionCatalog();
  assert.equal(approved.length, 127);
  assert.deepEqual([...PERMISSION_ROLE_CODES].sort(), SEED_ROLES.map(role => role.code).sort());
  assert.equal(PERMISSION_ROLE_CODES.length, 12);
  assert.equal(approved.some(grant => grant.roleCode === "GUEST" || grant.action === "IMPORT"), false);
  assert.deepEqual(approved.filter(grant => grant.module === "users").map(grant => [grant.roleCode, grant.action]).sort(),
    [["SUPERADMIN", "APPROVE"], ["SUPERADMIN", "CREATE"], ["SUPERADMIN", "READ"], ["SUPERADMIN", "UPDATE"]]);
  assert.equal(approved.some(grant => ["accounts", "user_roles", "role_permissions"].includes(grant.module)), false);
  assert.deepEqual(approved, INITIAL_PERMISSION_GRANTS);
});

test("perfil demo con RF22 real: instalación atómica, Argon2id, aislamiento y revocaciones conservadas", async t => {
  const approvedCatalog = await loadPermissionCatalog();
  const connectionString = target();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    // Cuenta previa de PDGLD-48 modificada por quien desarrolla: el perfil nuevo
    // debe conservarla aunque sus datos ya no sean los originales del seed.
    const legacyHash = await argon2.hash("Legacy-Changed-Synthetic!", { type: argon2.argon2id });
    const legacy = await prisma.users.create({ data: {
      email: "operativa@example.test", username: "legacy-preserved-pdgld54", password_hash: legacyHash,
      is_active: false, must_change_password: true,
      people: { create: { first_name: "Fixture previo", paternal_surname: "Conservado" } },
    } });
    const before = await snapshot(client);
    assert.equal(await prisma.role_permissions.count(), 0, "Ejecutar demo-seed después de la suite base, antes de fixtures de autorización.");
    assert.equal(await prisma.audit_logs.count({ where: { id: MATRIX_INSTALLATION.id } }), 0);
    await t.test("un historial sin concesiones vigentes ni marcador impide reinstalar permisos retirados", async () => {
      const actor = await prisma.users.findUniqueOrThrow({ where: { person_id: SEED_ACTOR.personId }, select: { id: true } });
      await assert.rejects(prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(54, 2026)::text`;
        // Evento sintético de una concesión ya eliminada. La transacción se
        // revierte por la denegación, sin modificar el historial inmutable real.
        await tx.audit_logs.create({ data: {
          user_id: actor.id, action: "DELETE", table_name: "role_permissions",
          entity_id: "54000000-0000-4000-8000-000000000059",
          reason: "PDGLD-54: fixture aislado de revocación anterior al instalador",
        } });
        assert.equal(await tx.role_permissions.count(), 0);
        await installPermissionCatalog(tx, validatePermissionCatalog(catalog), actor.id);
        throw new Error("El instalador permitió restaurar concesiones con historial previo.");
      }), error => error instanceof SeedConfigurationError);
      assert.deepEqual(await snapshot(client), before, "El fixture y cualquier intento de instalación se revierten completos.");
    });
    await t.test("fallo al provisionar la primera asignación revierte matriz, cuentas, contextos, marcadores y auditoría", async () => {
      try {
        await client.query("CREATE SEQUENCE public.seed_pdgld54_role_attempt");
        await client.query(`CREATE FUNCTION public.seed_pdgld54_reject_role() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN PERFORM nextval('public.seed_pdgld54_role_attempt'); RAISE EXCEPTION 'Fallo sintético PDGLD-54'; END $$`);
        await client.query("CREATE TRIGGER seed_pdgld54_reject_role BEFORE INSERT ON sports_management.user_roles FOR EACH ROW EXECUTE FUNCTION public.seed_pdgld54_reject_role()");
        await assert.rejects(seedDemoDatabase(prisma, catalog));
        const { rows } = await client.query("SELECT is_called FROM public.seed_pdgld54_role_attempt");
        assert.equal(rows[0].is_called, true);
        assert.deepEqual(await snapshot(client), before);
      } finally {
        await client.query("DROP TRIGGER IF EXISTS seed_pdgld54_reject_role ON sports_management.user_roles");
        await client.query("DROP FUNCTION IF EXISTS public.seed_pdgld54_reject_role()");
        await client.query("DROP SEQUENCE IF EXISTS public.seed_pdgld54_role_attempt");
      }
    });

    await t.test("dos instalaciones concurrentes crean un perfil y las 127 concesiones aprobadas", async () => {
      const results = await Promise.all([seedDemoDatabase(prisma, approvedCatalog), seedDemoDatabase(prisma, approvedCatalog)]);
      assert.equal(results.filter(result => result.alreadyInstalled).length, 1);
      assert.equal(await prisma.role_permissions.count(), 127);
      const installed = await prisma.role_permissions.findMany({ select: {
        roles: { select: { code: true } }, permissions: { select: { module: true, action: true } }, context_only: true,
      } });
      const normalize = (grants: readonly { roleCode: string; module: string; action: string; contextOnly: boolean }[]) =>
        grants.map(grant => JSON.stringify([grant.roleCode, grant.module, grant.action, grant.contextOnly])).sort();
      assert.deepEqual(normalize(installed.map(grant => ({ roleCode: grant.roles.code,
        module: grant.permissions.module, action: grant.permissions.action, contextOnly: grant.context_only }))),
      normalize(approvedCatalog), "Cada fila instalada conserva rol, módulo, acción y contexto exactos de RF22.");
      assert.equal(await prisma.audit_logs.count({ where: { id: DEMO_INSTALLATION.id } }), 1);
      const users = await prisma.users.findMany({ where: { person_id: { in: DEMO_ACCOUNTS.map(account => account.personId) } }, include: { user_roles: true } });
      assert.equal(users.length, 7);
      for (const account of DEMO_ACCOUNTS) {
        const user = users.find(row => row.person_id === account.personId)!;
        assert.equal(await argon2.verify(user.password_hash, DEMO_PASSWORD), true);
        assert.match(user.password_hash, /^\$argon2id\$/);
        assert.equal(user.is_active, account.active);
        assert.equal(user.must_change_password, account.temporary);
        assert.equal(user.user_roles.length, 1);
        assert.equal(user.user_roles[0].delegate_position, "delegatePosition" in account ? account.delegatePosition : null);
        assert.equal(user.user_roles[0].league_id, account.scope === "global" ? null : DEMO_CONTEXT.leagueId);
        assert.equal(user.user_roles[0].club_id, account.scope === "clubA" ? DEMO_CONTEXT.clubAId : account.scope === "clubB" ? DEMO_CONTEXT.clubBId : null);
        assert.equal(!!user.user_roles[0].ends_at, account.temporary);
      }
      const actor = await prisma.users.findUniqueOrThrow({ where: { person_id: SEED_ACTOR.personId }, include: { user_roles: true } });
      assert.equal(actor.is_active, false);
      assert.equal(actor.user_roles.length, 0);
      assert.equal(await prisma.user_roles.count({ where: { roles: { code: "GUEST" } } }), 0);
      assert.equal(await prisma.club_affiliations.count({ where: { season_id: DEMO_CONTEXT.seasonId, league_id: DEMO_CONTEXT.leagueId, club_id: { in: [DEMO_CONTEXT.clubAId, DEMO_CONTEXT.clubBId] }, status: "PENDING" } }), 2);
      assert.equal(await prisma.audit_logs.count({ where: { table_name: "role_permissions", action: "INSERT" } }), approvedCatalog.length, "El trigger genera un único evento por concesión.");
      assert.equal(await prisma.audit_logs.count({ where: { table_name: "user_roles", action: "INSERT" } }), 7);
      assert.deepEqual(await prisma.users.findUnique({ where: { id: legacy.id } }), legacy, "Se conserva la cuenta previa de desarrollo sin reactivar ni restablecer credenciales.");
    });

    await t.test("la repetición conserva contraseña, estado, vigencias y permisos/asignaciones retirados", async () => {
      const temporary = await prisma.users.findUniqueOrThrow({ where: { person_id: DEMO_ACCOUNTS[5].personId } });
      const delegate = await prisma.users.findUniqueOrThrow({ where: { person_id: DEMO_ACCOUNTS[3].personId } });
      const customHash = await argon2.hash("Changed-Synthetic-Password!", { type: argon2.argon2id });
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${temporary.id}, true), set_config('app.reason', 'PDGLD-54: fixture de revocación posterior al seed', true)`;
        await tx.users.update({ where: { id: temporary.id }, data: { password_hash: customHash, is_active: false, must_change_password: false } });
        await tx.user_roles.updateMany({ where: { user_id: temporary.id }, data: { starts_at: new Date("2025-01-01T00:00:00Z"), ends_at: new Date("2025-02-01T00:00:00Z") } });
        await tx.user_roles.updateMany({ where: { user_id: delegate.id }, data: { ends_at: new Date() } });
        await tx.role_permissions.deleteMany({ where: { roles: { code: "SECRETARY" } } });
        await tx.role_permissions.deleteMany({ where: { roles: { code: "SUPERADMIN" }, permissions: { module: "users", action: "CREATE" } } });
        await tx.role_permissions.updateMany({ where: { roles: { code: "CLUB_DELEGATE" } }, data: { context_only: false } });
      });
      const changed = await snapshot(client);
      assert.equal((await seedDemoDatabase(prisma, approvedCatalog)).alreadyInstalled, true);
      assert.equal((await seedPermissionDatabase(prisma, approvedCatalog)).installed, false);
      assert.deepEqual(await snapshot(client), changed, "No se escriben UPDATE vacíos, eventos duplicados ni concesiones retiradas.");
      assert.equal(await prisma.role_permissions.count({ where: { roles: { code: "SECRETARY" } } }), 0);
      assert.equal(await prisma.role_permissions.count({ where: { roles: { code: "SUPERADMIN" }, permissions: { module: "users", action: "CREATE" } } }), 0);
      assert.equal(await prisma.user_roles.count({ where: { user_id: delegate.id, ends_at: null } }), 0);
      assert.equal(await prisma.user_roles.count({ where: { user_id: delegate.id } }), 1, "La asignación cerrada se conserva.");
    });
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    throw new Error("Falló una prueba local del perfil demo; se omitieron detalles de conexión.");
  } finally {
    await prisma.$disconnect();
    await client.end();
  }
});
