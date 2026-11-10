import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getPrisma } from "../../src/server/db/prisma";
import {
  assertPermission,
  AuthorizationError,
  lockAuthorization,
} from "../../src/server/auth/authorization";

test("PDGLD-56: delegado no accede a otro club cambiando identificadores", async () => {
  // Estas guardas deben cumplirse antes de abrir la conexión.
  assert.equal(
    process.env.AUTH_TEST_RUN,
    "1",
    "Ejecuta esta prueba mediante npm run test:authorization.",
  );

  const target = new URL(process.env.DATABASE_URL ?? "");

  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname),
  );
  assert.ok(["5432", "5433"].includes(target.port || "5432"));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search, "");
  assert.equal(target.hash, "");

  const db = getPrisma();
  const suffix = randomUUID();
  const rollback = new Error("ROLLBACK_FIXTURES_PDGLD56");

  try {
    try {
      await db.$transaction(async (tx) => {
        await lockAuthorization(tx, "exclusive");

        const person = await tx.people.create({
          data: {
            first_name: "Delegado ficticio",
            paternal_surname: "Prueba",
          },
        });

        const actor = await tx.users.create({
          data: {
            person_id: person.id,
            username: `pd56-${suffix}`,
            email: `pd56-${suffix}@example.test`,
            password_hash: "fixture-without-login",
            must_change_password: false,
          },
        });

        await tx.$queryRaw`
          SELECT
            set_config('app.user_id', ${actor.id}, true),
            set_config('app.reason', 'PDGLD-56: datos sintéticos', true)
        `;

        const leagueA = await tx.leagues.create({
          data: { name: `Liga A PD56 ${suffix}` },
        });
        const leagueB = await tx.leagues.create({
          data: { name: `Liga B PD56 ${suffix}` },
        });

        const createClub = (leagueId: string, label: string) =>
          tx.clubs.create({
            data: {
              league_id: leagueId,
              name: `Club ficticio ${label}`,
              reference_number: `pd56-${label}-${suffix}`,
              status: "ACTIVE",
            },
          });

        const ownClub = await createClub(leagueA.id, "propio");
        const sameLeagueClub = await createClub(leagueA.id, "ajeno");
        const otherLeagueClub = await createClub(leagueB.id, "otra-liga");

        const role = await tx.roles.findUniqueOrThrow({
          where: { code: "CLUB_DELEGATE" },
        });

        const permission = await tx.permissions.upsert({
          where: {
            module_action: { module: "clubs", action: "READ" },
          },
          update: {},
          create: { module: "clubs", action: "READ" },
        });

        // Oráculo independiente: RF22 concede CRU* al delegado.
        // Esta prueba utiliza solamente READ y exige contexto propio.
        await tx.role_permissions.upsert({
          where: {
            role_id_permission_id: {
              role_id: role.id,
              permission_id: permission.id,
            },
          },
          update: { context_only: true },
          create: {
            role_id: role.id,
            permission_id: permission.id,
            context_only: true,
          },
        });

        await tx.user_roles.create({
          data: {
            user_id: actor.id,
            role_id: role.id,
            league_id: leagueA.id,
            club_id: ownClub.id,
            delegate_position: "PRIMARY",
            starts_at: new Date(Date.now() - 60_000),
          },
        });

        const readClub = (leagueId: string, clubId: string) =>
          assertPermission(tx, actor.id, {
            module: "clubs",
            action: "READ",
            context: { leagueId, clubId },
          });

        // Control positivo: evita aprobar una prueba que deniegue todo.
        const grants = await readClub(leagueA.id, ownClub.id);
        assert.ok(grants.length > 0);

        const forbidden = (error: unknown) =>
          error instanceof AuthorizationError &&
          error.status === 403 &&
          error.code === "FORBIDDEN";

        await assert.rejects(
          readClub(leagueA.id, sameLeagueClub.id),
          forbidden,
        );

        await assert.rejects(
          readClub(leagueB.id, otherLeagueClub.id),
          forbidden,
        );

        // Incluso sin enviar leagueId, el servidor debe resolver el club.
        await assert.rejects(
          assertPermission(tx, actor.id, {
            module: "clubs",
            action: "READ",
            context: { clubId: sameLeagueClub.id },
          }),
          forbidden,
        );

        // Revierte todos los fixtures y cualquier ajuste de permisos.
        throw rollback;
      }, { timeout: 30_000 });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  } finally {
    await db.$disconnect();
  }
});