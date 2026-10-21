import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "../../src/server/db/prisma";
import { hashPassword } from "../../src/server/auth/password";
import { lockAuthorization } from "../../src/server/auth/authorization";
import { readAccessOverview } from "../../src/features/auth/server/access-overview";
import { readAccountPresentation } from "../../src/features/auth/server/account-presentation";

test("Entrada pública de fútbol y panel con permisos vigentes por contexto", { timeout: 240_000 }, async (t) => {
  assert.equal(process.env.AUTH_TEST_RUN, "1");
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
  assert.ok(["5432", "5433"].includes(target.port || "5432"));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search, "");
  assert.equal(target.hash, "");
  const base = new URL(process.env.NEXTAUTH_URL ?? "");
  assert.equal(base.protocol, "http:");
  assert.equal(base.hostname, "127.0.0.1");
  assert.ok(base.port);
  const { Browser } = await import("./auth.test.mjs");
  const db = getPrisma();
  const suffix = randomUUID();
  const password = `Synthetic-${randomBytes(24).toString("hex")}!aA`;
  const email = `navigation-${suffix}@example.test`;
  const person = await db.people.create({ data: { first_name: `Identidad privada ${suffix}`, paternal_surname: "Prueba" } });
  const actor = await db.users.create({ data: { person_id: person.id, username: `navigation-${suffix}`, email,
    password_hash: await hashPassword(password), must_change_password: false } });
  const write = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(async (tx) => {
    await lockAuthorization(tx, "exclusive");
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
      set_config('app.reason', 'Prueba aislada del portal y resumen de permisos por contexto', true)`;
    return work(tx);
  });
  const roles = await db.roles.findMany({ where: { code: { in: ["SECRETARY", "PLAYER", "SUPERADMIN"] } }, select: { id: true, code: true } });
  const roleId = (code: string) => roles.find((role) => role.code === code)!.id;
  const grants: { roleId: string; permissionId: string; previous: { context_only: boolean } | null }[] = [];
  const createdPermissions: string[] = [];
  const ensureGrant = async (roleCode: string, module: string, action: string, contextOnly: boolean) => {
    const existingPermission = await db.permissions.findUnique({ where: { module_action: { module, action } } });
    const permission = existingPermission ?? await db.permissions.create({ data: { module, action } });
    if (!existingPermission) createdPermissions.push(permission.id);
    const grantKey = { role_id: roleId(roleCode), permission_id: permission.id };
    const previous = await db.role_permissions.findUnique({ where: { role_id_permission_id: grantKey }, select: { context_only: true } });
    grants.push({ roleId: grantKey.role_id, permissionId: permission.id, previous });
    await write((tx) => tx.role_permissions.upsert({ where: { role_id_permission_id: grantKey },
      create: { ...grantKey, context_only: contextOnly }, update: { context_only: contextOnly } }));
    return permission.id;
  };
  const browser = new Browser(base.origin);
  const anonymous = new Browser(base.origin);
  const scopeA = `Liga privada A ${suffix}`;
  const scopeB = `Liga privada B ${suffix}`;
  const clubName = `Club privado ${suffix}`;

  try {
    await t.test("inicio, fútbol y login son públicos; el espectador no crea identidad ni asignaciones", async () => {
      const counts = async () => [await db.users.count(), await db.user_roles.count(), await db.sessions.count()];
      const before = await counts();
      const home = await anonymous.request("/");
      assert.equal(home.status, 200);
      assert.equal(home.headers.get("location"), null);
      const html = await home.text();
      assert.ok(html.includes("Elige tu deporte"));
      const footballLink = html.match(/<a\b[^>]*aria-labelledby="football-title football-action"[^>]*>/)?.[0];
      assert.ok(footballLink?.includes('href="/futbol"'), "Elegir fútbol debe conservar la entrada al portal de esta rama.");
      assert.ok(html.includes("Entrar a fútbol"));
      assert.ok(html.includes("Básquetbol") && html.includes("Voleibol"));
      assert.equal((html.match(/>Próximamente</g) ?? []).length, 2);
      const text = html.replace(/<!--[\s\S]*?-->/g, "");
      assert.ok(text.includes("Básquetbol está en desarrollo.") && text.includes("Voleibol está en desarrollo."));
      assert.ok(!/href="\/(?:basketball|basquetbol|voleibol|volleyball)/.test(html));
      assert.ok(html.includes("Iniciar sesión") && !html.includes(`@${actor.username}`));
      const portal = await anonymous.request("/futbol");
      assert.equal(portal.status, 200);
      const content = await portal.text();
      for (const text of ["Partidos programados", "Resultados", "Tabla de posiciones", "Todavía no hay partidos publicados.",
        "Todavía no hay resultados publicados.", "Todavía no hay una tabla de posiciones publicada."])
        assert.ok(content.includes(text), "Falta una sección pública o su estado vacío.");
      assert.ok(!content.includes("Básquetbol") && !content.includes("Voleibol") && !/<video\b/.test(content));
      const login = await anonymous.request("/login");
      assert.equal(login.status, 200);
      assert.ok(/<a\b[^>]*href="\/futbol"[^>]*>Continuar como espectador<\/a>/.test(await login.text()));
      await anonymous.assertAccess(401, "UNAUTHENTICATED");
      assert.deepEqual(await counts(), before);
    });

    const leagueA = await db.leagues.create({ data: { name: scopeA } });
    const leagueB = await db.leagues.create({ data: { name: scopeB } });
    const club = await db.clubs.create({ data: { league_id: leagueB.id, name: clubName, reference_number: `navigation-${suffix}` } });
    const readClub = await ensureGrant("SECRETARY", "clubs", "READ", false);
    const updateClub = await ensureGrant("SECRETARY", "clubs", "UPDATE", false);
    await ensureGrant("PLAYER", "players", "READ", true);
    await write(async (tx) => {
      await tx.user_roles.create({ data: { user_id: actor.id, role_id: roleId("SECRETARY"), league_id: leagueA.id } });
      await tx.user_roles.create({ data: { user_id: actor.id, role_id: roleId("PLAYER"), league_id: leagueB.id, club_id: club.id } });
    });

    await t.test("el panel distingue permiso y ámbito, devuelve datos mínimos y mantiene las rutas privadas", async () => {
      for (const path of ["/access", "/change-password"]) {
        const response = await anonymous.request(path);
        assert.equal(response.status, 307);
        assert.equal(new URL(response.headers.get("location")!, base).pathname, "/login");
      }
      assert.equal((await browser.login(email, password)).searchParams.has("error"), false);
      const page = await browser.request("/access");
      assert.equal(page.status, 200);
      assert.ok((page.headers.get("cache-control") ?? "").includes("no-store"));
      const scopes = await db.$transaction((tx) => readAccessOverview(tx, actor.id));
      assert.deepEqual(scopes, [
        { title: clubName, description: scopeB, modules: [{ name: "Jugadores", actions: [{ label: "Consultar", contextOnly: true }] }] },
        { title: scopeA, description: "Permisos en esta liga", modules: [{ name: "Clubes y equipos", actions: [
          { label: "Consultar", contextOnly: false }, { label: "Actualizar", contextOnly: false },
        ] }] },
      ]);
      const content = await page.text();
      const header = content.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
      assert.ok(header.includes(`@${actor.username}`) && !header.includes(person.first_name));
      assert.ok(header.includes("Secretario") && header.includes("Jugador"));
      for (const value of [scopeA, clubName]) assert.ok(!header.includes(value));
      assert.ok(header.includes('aria-haspopup="menu"') && header.includes('aria-expanded="false"'));
      assert.ok(header.includes('role="menu"') && header.includes('hidden=""'));
      assert.ok(header.includes("Mi panel"));
      assert.ok(header.includes("Portal público"));
      assert.ok(header.indexOf("Mi panel") < header.indexOf("Portal público"));
      assert.equal((content.match(/>Cerrar sesión</g) ?? []).length, 1);
      assert.ok(content.includes(scopeA) && content.includes(clubName) && content.includes("Consultar") && content.includes("Actualizar"));
      assert.ok(content.includes("restringido"));
      const serialized = JSON.stringify(scopes);
      for (const value of [actor.id, person.id, leagueA.id, club.id, email, password, "password_hash", "roleId", "assignmentId", "permissionId"])
        assert.ok(!serialized.includes(value), "El resumen contiene datos internos innecesarios.");
      const login = await browser.request("/login");
      assert.equal(login.status, 307);
      assert.equal(new URL(login.headers.get("location")!, base).pathname, "/access");
    });

    await t.test("la presentación conserva todos los ámbitos sin conceder permisos ni ampliar la sesión", async () => {
      const identity = { id: actor.id, mustChangePassword: false };
      const presentation = await db.$transaction((tx) => readAccountPresentation(tx, identity, true));
      assert.deepEqual(presentation, {
        name: `${person.first_name} Prueba`, username: actor.username, initials: "IP", roleNames: ["Jugador", "Secretario"],
        assignments: [`Jugador · ${clubName} · ${scopeB}`, `Secretario · ${scopeA}`],
      });
      const publicPresentation = await db.$transaction((tx) => readAccountPresentation(tx, identity, false));
      assert.deepEqual(publicPresentation?.assignments, []);
      const session = await browser.session();
      assert.deepEqual(Object.keys(session.user).sort(), ["id", "mustChangePassword"]);
      // El nombre de usuario sigue sin ser una credencial de login.
      assert.ok((await anonymous.login(actor.username, password)).searchParams.has("error"));
      const before = await db.user_roles.count({ where: { user_id: actor.id } });
      for (const path of ["/futbol", "/", "/access"]) {
        const page = await browser.request(path);
        assert.equal(page.status, 200);
        const content = await page.text();
        assert.ok(content.includes(`@${actor.username}`));
        if (path !== "/access") assert.ok(content.includes("Ir a mi panel"));
        if (path === "/futbol") assert.ok(!content.includes("¿Formas parte de la liga?"));
      }
      await browser.assertAccess(200);
      assert.equal(await db.user_roles.count({ where: { user_id: actor.id } }), before);
    });

    await t.test("un username heredado que contiene correo no se divulga ni se modifica", async () => {
      try {
        await db.users.update({ where: { id: actor.id }, data: { username: email } });
        const page = await browser.request("/futbol");
        const content = await page.text();
        assert.equal(page.status, 200);
        assert.ok(content.includes("Mi cuenta") && !content.includes(email) && !content.includes(person.first_name));
        assert.equal((await db.users.findUniqueOrThrow({ where: { id: actor.id }, select: { username: true } })).username, email);
      } finally {
        await db.users.update({ where: { id: actor.id }, data: { username: actor.username } });
      }
    });

    await t.test("una concesión contextual sin ámbito no se anuncia como autoridad global", async () => {
      const permission = await ensureGrant("SUPERADMIN", "users", "READ", true);
      await write((tx) => tx.user_roles.create({ data: { user_id: actor.id, role_id: roleId("SUPERADMIN") } }));
      let scopes = await db.$transaction((tx) => readAccessOverview(tx, actor.id));
      assert.ok(!scopes.some((scope) => scope.title === "Gestión general"));
      await write((tx) => tx.role_permissions.update({ where: { role_id_permission_id: { role_id: roleId("SUPERADMIN"), permission_id: permission } },
        data: { context_only: false } }));
      scopes = await db.$transaction((tx) => readAccessOverview(tx, actor.id));
      assert.deepEqual(scopes.find((scope) => scope.title === "Gestión general")?.modules,
        [{ name: "Usuarios y roles", actions: [{ label: "Consultar", contextOnly: false }] }]);
      await write((tx) => tx.user_roles.deleteMany({ where: { user_id: actor.id, role_id: roleId("SUPERADMIN") } }));
    });

    await t.test("retirar permisos actualiza el panel con la misma sesión sin mezclarlos entre ligas", async () => {
      await write((tx) => tx.role_permissions.delete({ where: { role_id_permission_id: { role_id: roleId("SECRETARY"), permission_id: updateClub } } }));
      let page = await browser.request("/access");
      assert.equal(page.status, 200);
      let content = await page.text();
      assert.ok(!content.includes("Actualizar") && content.includes("Consultar"));
      await write((tx) => tx.role_permissions.delete({ where: { role_id_permission_id: { role_id: roleId("SECRETARY"), permission_id: readClub } } }));
      page = await browser.request("/access");
      assert.equal(page.status, 200);
      content = await page.text();
      const overview = await db.$transaction((tx) => readAccessOverview(tx, actor.id));
      assert.ok(!overview.some((scope) => scope.title === scopeA) && content.includes(clubName));
      await write((tx) => tx.user_roles.updateMany({ where: { user_id: actor.id, role_id: roleId("PLAYER") }, data: { starts_at: new Date(Date.now() + 3_600_000) } }));
      page = await browser.request("/access");
      assert.equal(page.status, 200);
      const futureContent = await page.text();
      assert.ok(futureContent.includes("Tu cuenta todavía no tiene funciones habilitadas."));
      const header = futureContent.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
      assert.ok(!header.includes("Jugador") && !header.includes(clubName));
    });

    await t.test("las páginas públicas identifican solo la cuenta propia y omiten ámbitos y datos internos", async () => {
      for (const path of ["/", "/futbol"]) {
        const response = await browser.request(path);
        assert.equal(response.status, 200);
        const content = await response.text();
        assert.ok(content.includes(`@${actor.username}`) && !content.includes(person.first_name));
        assert.ok(content.includes("Ir a mi panel"));
        assert.ok((response.headers.get("cache-control") ?? "").includes("no-store"));
        for (const value of [email, password, actor.id, person.id, scopeA, scopeB, clubName, "password_hash", "encrypted_mfa_secret"])
          assert.ok(!content.includes(value), "La respuesta pública contiene datos privados.");
        const anonymousPage = await anonymous.request(path);
        const anonymousContent = await anonymousPage.text();
        assert.ok(anonymousContent.includes("Iniciar sesión") && !anonymousContent.includes(person.first_name));
      }
    });

    await t.test("el cambio obligatorio conserva su redirección y el portal sigue accesible", async () => {
      await write((tx) => tx.users.update({ where: { id: actor.id }, data: { must_change_password: true, version: { increment: 1 } } }));
      const temporary = new Browser(base.origin);
      assert.equal((await temporary.login(email, password)).searchParams.has("error"), false);
      for (const path of ["/login", "/access"]) {
        const page = await temporary.request(path);
        assert.equal(page.status, 307);
        assert.equal(new URL(page.headers.get("location")!, base).pathname, "/change-password");
      }
      const change = await temporary.request("/change-password");
      assert.equal(change.status, 200);
      assert.ok((await change.text()).includes(`@${actor.username}`));
      const portal = await temporary.request("/futbol");
      assert.equal(portal.status, 200);
      const content = await portal.text();
      assert.ok(content.includes("Cambiar contraseña") && !content.includes("Ir a mi panel"));
      assert.ok(!content.includes("¿Formas parte de la liga?"));
      await temporary.assertAccess(403, "PASSWORD_CHANGE_REQUIRED");
      await write((tx) => tx.users.update({ where: { id: actor.id }, data: { must_change_password: false, version: { increment: 1 } } }));
    });

    await t.test("cerrar sesión y entrar con otra cuenta no conserva la identidad anterior", async () => {
      await browser.login(email, password);
      const logout = await browser.request("/api/auth/signout", { method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrfToken: await browser.csrf(), callbackUrl: "/login", json: "true" }),
      });
      assert.equal(logout.status, 200);
      await browser.assertAccess(401, "UNAUTHENTICATED");
      const publicPage = await browser.request("/futbol");
      assert.ok(!(await publicPage.text()).includes(person.first_name));
      const otherPerson = await db.people.create({ data: { first_name: "Otra identidad sintética", paternal_surname: "Segunda" } });
      const otherEmail = `second-${suffix}@example.test`;
      const username = `second-${suffix}`;
      await db.users.create({ data: { person_id: otherPerson.id, username, email: otherEmail,
        password_hash: await hashPassword(password), must_change_password: false } });
      await browser.login(otherEmail, password);
      for (const path of ["/access", "/futbol", "/"]) {
        const page = await browser.request(path);
        assert.equal(page.status, 200);
        const content = await page.text();
        assert.ok(content.includes(`@${username}`) && !content.includes(otherPerson.first_name));
        assert.ok(!content.includes(person.first_name) && !content.includes(`@${actor.username}`));
      }
    });

    await t.test("una cookie vencida no impide consultar el portal ni abre el panel", async () => {
      const expired = new Browser(base.origin);
      await expired.login(email, password);
      await db.$executeRaw`UPDATE sports_management.sessions SET created_at = now() - interval '2 hours',
        last_activity_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute' WHERE user_id = ${actor.id}::uuid`;
      assert.equal((await expired.request("/futbol")).status, 200);
      const privatePage = await expired.request("/access");
      assert.equal(privatePage.status, 307);
      assert.equal(new URL(privatePage.headers.get("location")!, base).pathname, "/login");
    });
  } finally {
    try {
      await write(async (tx) => {
        for (const grant of grants) {
          const key = { role_id: grant.roleId, permission_id: grant.permissionId };
          if (grant.previous) await tx.role_permissions.upsert({ where: { role_id_permission_id: key },
            create: { ...key, context_only: grant.previous.context_only }, update: { context_only: grant.previous.context_only } });
          else await tx.role_permissions.deleteMany({ where: key });
        }
        await tx.user_roles.deleteMany({ where: { user_id: actor.id } });
        await tx.users.update({ where: { id: actor.id }, data: { is_active: false } });
        if (createdPermissions.length) await tx.permissions.deleteMany({ where: { id: { in: createdPermissions } } });
      });
    } finally { await db.$disconnect(); }
  }
});
