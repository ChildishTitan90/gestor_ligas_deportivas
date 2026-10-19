import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readAccountCreationOptions } from "../../src/features/accounts/server/creation-options";
import { accountRoleCodes } from "../../src/features/accounts/schemas";
import { INITIAL_PERMISSION_GRANTS } from "../../prisma/permissions-data";
import {
  assertCanGrantRole, assertPermission, AuthorizationError, lockAuthorization,
} from "../../src/server/auth/authorization";

test("PDGLD-54: opciones agrupadas equivalentes, revocables y sin consultas por rol/permiso", async (t) => {
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.AUTH_TEST_RUN, "1");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search, "");
  assert.equal(target.hash, "");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.href }),
    log: [{ level: "query", emit: "event" }] });
  let queries = 0;
  db.$on("query", () => { queries++; }); // Nunca imprimir query ni params.
  const suffix = randomUUID();
  const people = await db.people.create({ data: { first_name: "Opciones sintéticas", paternal_surname: "Rendimiento" } });
  const actor = await db.users.create({ data: { person_id: people.id, username: `options-${suffix}`,
    email: `options-${suffix}@example.test`, password_hash: "synthetic-without-login", must_change_password: false } });
  const write = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(async (tx) => {
    await lockAuthorization(tx, "exclusive");
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
      set_config('app.reason', 'PDGLD-54: fixture local de rendimiento de opciones', true)`;
    return work(tx);
  });
  const roles = await db.roles.findMany();
  const roleId = (code: string) => roles.find((role) => role.code === code)!.id;
  const createdGrants: string[] = [];
  const addedPermissions: string[] = [];
  const assignments: string[] = [];
  const fixtures = await db.leagues.createManyAndReturn({ data: [{ name: `Options A ${suffix}` }, { name: `Options B ${suffix}` }] });
  const [leagueA, leagueB] = fixtures;
  const clubs = await db.clubs.createManyAndReturn({ data: [
    { league_id: leagueA.id, reference_number: randomUUID(), name: "Options Club A" },
    { league_id: leagueA.id, reference_number: randomUUID(), name: "Options Club B" },
    { league_id: leagueB.id, reference_number: randomUUID(), name: "Options Club C" },
  ] });
  async function newActor(leagueId?: string, clubId?: string) {
    const person = await db.people.create({ data: { first_name: "Contexto sintético", paternal_surname: "Opciones" } });
    const user = await db.users.create({ data: { person_id: person.id, username: `options-${randomUUID()}`,
      email: `options-${randomUUID()}@example.test`, password_hash: "synthetic-without-login", must_change_password: false } });
    const assignment = await write((tx) => tx.user_roles.create({ data: { user_id: user.id, role_id: roleId("SUPERADMIN"),
      league_id: leagueId, club_id: clubId } }));
    assignments.push(assignment.id);
    return { ...user, assignmentId: assignment.id };
  }
  async function options(actorId: string, leagueId?: string) {
    queries = 0;
    const result = await db.$transaction((tx) => readAccountCreationOptions(tx, actorId, leagueId));
    const count = queries;
    assert.ok(!("invalidLeague" in result));
    assert.ok(count <= 10, `Opciones debe usar consultas acotadas; ejecutó ${count}.`);
    return { result, count };
  }
  const codes = (data: { roles: { code: string }[] }) => data.roles.map((role) => role.code).sort();
  const denied = (work: Promise<unknown>) => assert.rejects(work, (error: unknown) => error instanceof AuthorizationError);
  async function oracle(actorId: string, leagueId: string) {
    // Guards de escritura existentes como referencia independiente de la agrupación.
    return db.$transaction(async (tx) => {
      const allowed: string[] = [];
      for (const code of accountRoleCodes) {
        const context = code === "SUPERADMIN" ? {} : { leagueId };
        try {
          await assertPermission(tx, actorId, { module: "users", action: "CREATE", context });
          await assertCanGrantRole(tx, actorId, roleId(code), context);
          allowed.push(code);
        } catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
      }
      return allowed.sort();
    });
  }
  try {
    await write(async (tx) => {
      for (const grant of INITIAL_PERMISSION_GRANTS) {
        const permission = await tx.permissions.upsert({ where: { module_action: { module: grant.module, action: grant.action } },
          update: {}, create: { module: grant.module, action: grant.action } });
        const existing = await tx.role_permissions.findUnique({ where: { role_id_permission_id: {
          role_id: roleId(grant.roleCode), permission_id: permission.id } } });
        assert.equal(existing, null, "El harness retira las concesiones RF22 antes de los fixtures aislados.");
        const created = await tx.role_permissions.create({ data: { role_id: roleId(grant.roleCode),
          permission_id: permission.id, context_only: grant.contextOnly } });
        createdGrants.push(created.id);
      }
    });
    const global = await newActor();
    const local = await newActor(leagueA.id);
    const club = await newActor(leagueA.id, clubs[0].id);
    const permissionId = async (action: string) => (await db.permissions.findUniqueOrThrow({ where: { module_action: { module: "users", action } } })).id;
    const change = async (action: string, contextOnly?: boolean) => {
      const id = await permissionId(action);
      return write((tx) => contextOnly === undefined
        ? tx.role_permissions.delete({ where: { role_id_permission_id: { role_id: roleId("SUPERADMIN"), permission_id: id } } })
        : tx.role_permissions.create({ data: { role_id: roleId("SUPERADMIN"), permission_id: id, context_only: contextOnly } }));
    };
    await t.test("administrador global obtiene las mismas opciones y nueve roles con RF22 real", async () => {
      const { result } = await options(global.id, leagueA.id);
      assert.deepEqual(codes(result), [...accountRoleCodes].sort());
      assert.deepEqual(codes(result), await oracle(global.id, leagueA.id));
      assert.deepEqual(result.clubs.map((entry) => entry.id).sort(), clubs.slice(0, 2).map((entry) => entry.id).sort());
      assert.ok(result.leagues.some((entry) => entry.id === leagueB.id));
    });
    await t.test("liga y club conservan sus opciones; el contexto ajeno no se mezcla", async () => {
      const localOptions = (await options(local.id, leagueA.id)).result;
      assert.deepEqual(localOptions.leagues.map((entry) => entry.id), [leagueA.id]);
      assert.deepEqual(codes(localOptions), await oracle(local.id, leagueA.id));
      const clubOptions = (await options(club.id, leagueA.id)).result;
      assert.deepEqual(codes(clubOptions), ["CLUB_DELEGATE"]);
      assert.deepEqual(clubOptions.clubs.map((entry) => entry.id), [clubs[0].id]);
      const unavailable = await db.$transaction((tx) => readAccountCreationOptions(tx, local.id, leagueB.id));
      assert.deepEqual(unavailable, { invalidLeague: false });
      assert.deepEqual(await db.$transaction((tx) => readAccountCreationOptions(tx, global.id, randomUUID())), { invalidLeague: true });
    });
    await t.test("las opciones retienen el bloqueo compartido hasta terminar su transacción", async () => {
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const loaded = new Promise<void>((resolve) => { ready = resolve; });
      const reading = db.$transaction(async (tx) => {
        await readAccountCreationOptions(tx, global.id, leagueA.id);
        ready();
        await gate;
      });
      // Si la lectura falla, no dejar esperando una señal que nunca llegará.
      await Promise.race([loaded, reading]);
      try {
        await db.$transaction(async (tx) => {
          const result = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(54, 2026) AS locked`;
          assert.equal(result[0].locked, false, "El escritor no puede cambiar política durante la lectura.");
        });
      } finally { release(); await reading; }
      await db.$transaction(async (tx) => {
        const result = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(54, 2026) AS locked`;
        assert.equal(result[0].locked, true);
      });
    });
    await t.test("roles futuros/vencidos se deniegan; autoridad temporal solo permite consultar", async () => {
      for (const dates of [
        { starts_at: new Date(Date.now() + 86_400_000), ends_at: null },
        { starts_at: new Date(Date.now() - 86_400_000), ends_at: new Date(Date.now() - 60_000) },
      ]) {
        await write((tx) => tx.user_roles.update({ where: { id: local.assignmentId }, data: dates }));
        await denied(options(local.id, leagueA.id));
      }
      await write((tx) => tx.user_roles.update({ where: { id: local.assignmentId }, data: {
        starts_at: new Date(Date.now() - 60_000), ends_at: new Date(Date.now() + 86_400_000) } }));
      assert.deepEqual((await options(local.id, leagueA.id)).result.roles, []);
    });
    await t.test("APPROVE revocable no permite fabricar autoridad ni ejecutar programación", async () => {
      await change("APPROVE");
      try {
        const result = (await options(global.id, leagueA.id)).result;
        assert.ok(!codes(result).includes("SCHEDULER"));
        assert.deepEqual(codes(result), await oracle(global.id, leagueA.id));
      } finally { createdGrants.push((await change("APPROVE", false)).id); }
    });
    await t.test("más permisos candidatos y más contextos no multiplican consultas SQL", async () => {
      const before = await options(global.id, leagueA.id);
      await write(async (tx) => {
        for (let index = 0; index < 30; index++) {
          const permission = await tx.permissions.create({ data: { module: `fixture.options.${suffix}.${index}`, action: "CREATE" } });
          addedPermissions.push(permission.id);
          const grant = await tx.role_permissions.create({ data: { role_id: roleId("SCHEDULER"), permission_id: permission.id, context_only: true } });
          createdGrants.push(grant.id);
        }
      });
      const after = await options(global.id, leagueA.id);
      assert.deepEqual(after.result, before.result);
      assert.equal(after.count, before.count);
      await change("CREATE");
      try {
        const beforeContexts = await options(global.id);
        assert.deepEqual(beforeContexts.result.roles, []);
        await db.leagues.createMany({ data: Array.from({ length: 20 }, (_, index) => ({ name: `Options extra ${index} ${suffix}` })) });
        const afterContexts = await options(global.id);
        assert.equal(afterContexts.count, beforeContexts.count);
        assert.deepEqual(afterContexts.result.roles, []);
        assert.equal(afterContexts.result.leagues.length, beforeContexts.result.leagues.length + 20);
      } finally { createdGrants.push((await change("CREATE", false)).id); }
    });
    await t.test("sin READ se deniega la siguiente lectura y sin UPDATE no se ofrecen roles", async () => {
      await denied(options(actor.id, leagueA.id));
      await change("UPDATE");
      try { assert.deepEqual((await options(global.id, leagueA.id)).result.roles, []); }
      finally { createdGrants.push((await change("UPDATE", false)).id); }
      await change("READ");
      try { await denied(options(global.id, leagueA.id)); }
      finally { createdGrants.push((await change("READ", false)).id); }
    });
  } finally {
    await write(async (tx) => {
      await tx.user_roles.deleteMany({ where: { id: { in: assignments } } });
      await tx.role_permissions.deleteMany({ where: { id: { in: createdGrants } } });
      await tx.permissions.deleteMany({ where: { id: { in: addedPermissions } } });
    });
    await db.$disconnect();
  }
});
