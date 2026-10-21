import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import * as argon2 from "argon2";
import { getPrisma } from "../../src/server/db/prisma";
import { lockAuthorization } from "../../src/server/auth/authorization";

test("PDGLD-56: autorización HTTP y revocación con la misma sesión", {
  timeout: 90_000,
}, async () => {
  assert.equal(process.env.AUTH_TEST_RUN, "1");

  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname),
  );
  assert.ok(["5432", "5433"].includes(target.port || "5432"));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search, "");
  assert.equal(target.hash, "");

  const base = new URL(process.env.NEXTAUTH_URL ?? "");
  assert.equal(base.protocol, "http:");
  assert.equal(base.hostname, "127.0.0.1");
  assert.ok(base.port);
  assert.equal(base.username, "");
  assert.equal(base.password, "");

  // Reutiliza el cliente HTTP existente, sin ejecutar su suite.
  const { Browser } = await import("./auth.test.mjs");
  const db = getPrisma();
  const suffix = randomUUID();
  const email = `pd56-http-${suffix}@example.test`;
  const password = `Synthetic-${randomBytes(24).toString("hex")}!aA`;

  let actorId: string | undefined;
  let assignmentId: string | undefined;
  let grantId: string | undefined;
  let permissionId: string | undefined;
  let createdPermission = false;

  try {
    const anonymous = new Browser(base.origin);
    assert.equal(
      (await anonymous.request("/api/accounts")).status,
      401,
      "Sin autenticación debe responder 401.",
    );

    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const role = await db.roles.findUniqueOrThrow({
      where: { code: "SUPERADMIN" },
    });

    const existing = await db.permissions.findUnique({
      where: {
        module_action: { module: "users", action: "READ" },
      },
    });

    const permission = existing ?? await db.permissions.create({
      data: { module: "users", action: "READ" },
    });
    permissionId = permission.id;
    createdPermission = !existing;

    // La suite anterior debe haber limpiado sus concesiones.
    // No sobrescribir una concesión ajena para preparar esta prueba.
    const previousGrant = await db.role_permissions.findUnique({
      where: {
        role_id_permission_id: {
          role_id: role.id,
          permission_id: permission.id,
        },
      },
    });
    assert.equal(
      previousGrant,
      null,
      "El fixture requiere SUPERADMIN sin users:READ; no modificar datos previos.",
    );

    const person = await db.people.create({
      data: {
        first_name: "HTTP sintético",
        paternal_surname: "PDGLD56",
      },
    });

    const actor = await db.users.create({
      data: {
        person_id: person.id,
        username: `pd56-http-${suffix}`,
        email,
        password_hash: hash,
        must_change_password: false,
      },
    });
    actorId = actor.id;

    await db.$transaction(async (tx) => {
      await lockAuthorization(tx, "exclusive");
      await tx.$queryRaw`
        SELECT
          set_config('app.user_id', ${actor.id}, true),
          set_config('app.reason', 'PDGLD-56: fixture HTTP', true)
      `;
      const assignment = await tx.user_roles.create({
        data: {
          user_id: actor.id,
          role_id: role.id,
          starts_at: new Date(Date.now() - 60_000),
        },
      });
      assignmentId = assignment.id;
    });

    const browser = new Browser(base.origin);
    const login = await browser.login(email, password);
    assert.equal(login.searchParams.has("error"), false);

    assert.equal(
      (await browser.request("/api/accounts")).status,
      403,
      "SUPERADMIN sin permiso explícito debe recibir 403.",
    );

    await db.$transaction(async (tx) => {
      await lockAuthorization(tx, "exclusive");
      await tx.$queryRaw`
        SELECT
          set_config('app.user_id', ${actor.id}, true),
          set_config('app.reason', 'PDGLD-56: conceder lectura sintética', true)
      `;
      const grant = await tx.role_permissions.create({
        data: {
          role_id: role.id,
          permission_id: permission.id,
          context_only: false,
        },
      });
      grantId = grant.id;
    });

    assert.equal(
      (await browser.request("/api/accounts")).status,
      200,
      "Con users:READ vigente debe permitir consultar.",
    );

    const sessionBefore = await browser.session();
    assert.equal(sessionBefore.user.id, actor.id);

    await db.$transaction(async (tx) => {
      await lockAuthorization(tx, "exclusive");
      await tx.$queryRaw`
        SELECT
          set_config('app.user_id', ${actor.id}, true),
          set_config('app.reason', 'PDGLD-56: revocar lectura sintética', true)
      `;
      await tx.role_permissions.delete({
        where: { id: grantId! },
      });
    });
    grantId = undefined;

    // No se vuelve a iniciar sesión.
    assert.equal(
      (await browser.request("/api/accounts")).status,
      403,
      "La siguiente petición debe observar la revocación.",
    );

    const sessionAfter = await browser.session();
    assert.equal(sessionAfter.user.id, sessionBefore.user.id);
    await browser.assertAccess(200);

    const assignment = await db.user_roles.findUniqueOrThrow({
      where: { id: assignmentId! },
    });
    assert.equal(assignment.user_id, actor.id);
    assert.equal(assignment.role_id, role.id);
  } finally {
    try {
      if (actorId) {
        const cleanupActor = actorId;
        await db.$transaction(async (tx) => {
          await lockAuthorization(tx, "exclusive");
          await tx.$queryRaw`
            SELECT
              set_config('app.user_id', ${cleanupActor}, true),
              set_config('app.reason', 'PDGLD-56: limpieza de fixtures propios', true)
          `;
          if (grantId) {
            await tx.role_permissions.deleteMany({
              where: { id: grantId },
            });
          }
          if (assignmentId) {
            await tx.user_roles.deleteMany({
              where: { id: assignmentId, user_id: cleanupActor },
            });
          }
          await tx.users.update({
            where: { id: cleanupActor },
            data: { is_active: false },
          });
        });
      }

      if (createdPermission && permissionId) {
        await db.permissions.delete({
          where: { id: permissionId },
        });
      }

      // Se conserva la identidad sintética vinculada a la auditoría.
      // El runner elimina al finalizar toda su base temporal.
    } finally {
      await db.$disconnect();
    }
  }
});
