import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getPrisma } from "../../src/server/db/prisma";
import { applyClubOrTeamMaintenance } from "../../src/features/clubs/server/maintenance";
import { assertPermission, lockAuthorization } from "../../src/server/auth/authorization";
import { hashPassword } from "../../src/server/auth/password";

test("PDGLD-121: bajas, reactivación, concurrencia, ámbito e historial", async t => {
  assert.equal(process.env.AUTH_TEST_RUN, "1");
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const db = getPrisma();
  const tag = randomUUID();
  const league = await db.leagues.create({ data: { name: `Mantenimiento ${tag}` } });
  const foreign = await db.leagues.create({ data: { name: `Otra liga ${tag}` } });
  const club = await db.clubs.create({ data: { league_id: league.id, reference_number: randomUUID(), name: "Club de prueba" } });
  const other = await db.clubs.create({ data: { league_id: foreign.id, reference_number: randomUUID(), name: "Club ajeno" } });
  const team = await db.teams.create({ data: { club_id: club.id, reference_number: randomUUID(), name: "Equipo de prueba" } });
  const role = await db.roles.create({ data: { code: `PD121-${tag}`, name: "Mantenimiento sintético" } });
  const person = await db.people.create({ data: { first_name: "Sintético", paternal_surname: "Mantenimiento" } });
  const password = `Synthetic-${randomUUID()}!aA`;
  const actor = await db.users.create({ data: { person_id: person.id, username: `maintenance-${tag}`, email: `${tag}@example.test`, password_hash: await hashPassword(password), must_change_password: false } });
  await db.$transaction(async tx => {
    await lockAuthorization(tx, "exclusive");
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', 'Preparar permisos sintéticos PDGLD-121', true)`;
    for (const action of ["READ", "UPDATE", "APPROVE", "CREATE"]) {
      const permission = await tx.permissions.upsert({ where: { module_action: { module: "clubs", action } }, create: { module: "clubs", action }, update: {} });
      await tx.role_permissions.create({ data: { role_id: role.id, permission_id: permission.id, context_only: true } });
    }
    await tx.user_roles.create({ data: { user_id: actor.id, role_id: role.id, league_id: league.id } });
  });
  const input = (kind: "club" | "team", id: string, version: number, operation: string) => ({ kind, id, version, operation, reason: "Prueba de mantenimiento administrativo", confirmed: true });
  try {
    await t.test("pantalla real exige sesión y filtra por liga en servidor", async () => {
      const { Browser } = await import("./auth.test.mjs");
      const base = new URL(process.env.NEXTAUTH_URL!);
      assert.equal(base.hostname, "127.0.0.1");
      const browser = new Browser(base.origin);
      const anonymous = await browser.request("/clubs");
      assert.ok([302, 303, 307].includes(anonymous.status));
      await browser.login(actor.email, password);
      const page = await browser.request("/clubs");
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.ok(html.includes("Administrar clubes y equipos"));
      assert.ok(html.includes(club.reference_number));
      assert.ok(!html.includes(other.reference_number));
      assert.ok(html.includes("Tiene referencias o historial"));
      const teamsPage = await browser.request("/clubs?kind=team");
      const teamsHtml = await teamsPage.text();
      assert.ok(teamsHtml.includes(team.reference_number));
      assert.ok(teamsHtml.includes("Eliminar definitivamente"));
      assert.ok(!teamsHtml.includes(other.reference_number));
      const filtered = await browser.request("/clubs?kind=team&q=NoExiste");
      assert.ok((await filtered.text()).includes("No hay registros para estos filtros"));
      if (process.env.CHROME_BIN) {
        const { launchChrome } = await import("../e2e/chrome-session.mjs");
        const chrome = await launchChrome(base.origin);
        try {
          await chrome.command("Network.setCookies", { cookies: [...browser.cookies].map(([name, value]) => ({ name, value, url: base.origin })) });
          await chrome.command("Page.navigate", { url: `${base.origin}/clubs?kind=team` });
          const waitFor = async (expression: string) => {
            for (let i = 0; i < 100; i++) {
              if (await chrome.evaluate(expression)) return;
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            assert.fail("El control de mantenimiento no estuvo disponible en el navegador");
          };
          await waitFor("document.body?.innerText.includes('Eliminar definitivamente')");
          await waitFor("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Eliminar definitivamente'); return b && Object.keys(b).some(k=>k.startsWith('__reactProps'));})()");
          for (const width of [390, 1280]) {
            await chrome.command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
            for (const theme of ["light", "dark"]) {
              await chrome.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
              await chrome.evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Eliminar definitivamente'); b.focus(); b.click();})()");
              await waitFor("!!document.querySelector('dialog[open]')");
              assert.ok(await chrome.evaluate("document.querySelector('dialog[open]').innerText.includes('no se puede deshacer')"));
              assert.ok(await chrome.evaluate("document.querySelector('dialog[open]').contains(document.activeElement)"));
              assert.ok(await chrome.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
              const { writeFile, mkdir } = await import("node:fs/promises");
              await mkdir(".next-auth-tests/maintenance-evidence", { recursive: true });
              const capture = await chrome.command("Page.captureScreenshot", { format: "png" });
              await writeFile(`.next-auth-tests/maintenance-evidence/${width}-${theme}.png`, Buffer.from(capture.data, "base64"));
              await chrome.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
              await chrome.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
              await waitFor("!document.querySelector('dialog[open]')");
              assert.equal(await chrome.evaluate("document.activeElement.textContent"), "Eliminar definitivamente");
            }
          }
          console.log("PDGLD-123: diálogo real en móvil/escritorio, claro/oscuro, foco y Escape verificados.");
          const disposable = await db.teams.create({ data: { club_id: club.id, name: "Equipo para eliminación desde navegador", reference_number: randomUUID() } });
          await chrome.command("Page.navigate", { url: `${base.origin}/clubs?kind=team&q=${disposable.reference_number}` });
          await waitFor(`document.body?.innerText.includes(${JSON.stringify(disposable.reference_number)})`);
          await waitFor("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Eliminar definitivamente'); return b && Object.keys(b).some(k=>k.startsWith('__reactProps'));})()");
          await chrome.evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Eliminar definitivamente'); b.focus(); b.click();})()");
          await waitFor("!!document.querySelector('dialog[open]')");
          await chrome.evaluate("(()=>{const t=document.getElementById('maintenance-reason'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Eliminación sintética desde interfaz'); t.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('dialog[open] input[type=checkbox]').click();})()");
          await chrome.evaluate("document.querySelector('dialog[open] form').requestSubmit()");
          await waitFor("document.body?.innerText.includes('Registro eliminado. La auditoría de la operación se conserva.')");
          assert.equal(await db.teams.findUnique({ where: { id: disposable.id } }), null);
          assert.equal(await db.audit_logs.count({ where: { entity_id: disposable.id, action: "DELETE" } }), 1);
          console.log("PDGLD-123: envío real desde navegador, eliminación y auditoría única confirmados.");
        } finally { await chrome.close(); }
      }
    });
    await t.test("permiso de liga no permite operar sobre un club ajeno", async () => {
      await assert.rejects(applyClubOrTeamMaintenance(actor.id, input("club", other.id, 1, "deactivate")), /FORBIDDEN/);
      assert.equal((await db.clubs.findUniqueOrThrow({ where: { id: other.id } })).status, "ACTIVE");
    });
    await t.test("baja individual conserva equipo y registra exactamente un motivo", async () => {
      await applyClubOrTeamMaintenance(actor.id, input("team", team.id, 1, "deactivate"));
      const updated = await db.teams.findUniqueOrThrow({ where: { id: team.id } });
      assert.equal(updated.status, "INACTIVE"); assert.equal(updated.club_id, club.id); assert.equal(updated.name, team.name);
      assert.equal(await db.audit_logs.count({ where: { entity_id: team.id, table_name: "teams" } }), 1);
      await assert.rejects(applyClubOrTeamMaintenance(actor.id, input("team", team.id, 1, "deactivate")), /CONFLICT/);
      assert.equal(await db.audit_logs.count({ where: { entity_id: team.id, table_name: "teams" } }), 1);
    });
    await t.test("baja de club bloquea permisos operativos sin perder sus equipos", async () => {
      await applyClubOrTeamMaintenance(actor.id, input("club", club.id, 1, "deactivate"));
      await assert.rejects(db.$transaction(tx => assertPermission(tx, actor.id, { module: "clubs", action: "CREATE", context: { clubId: club.id } })), /FORBIDDEN/);
      await assert.rejects(applyClubOrTeamMaintenance(actor.id, input("team", team.id, 2, "reactivate")), /INVALID_STATE/);
      assert.equal(await db.teams.count({ where: { club_id: club.id } }), 1);
    });
    await t.test("reactivar club no reactiva equipos dados de baja individualmente", async () => {
      await applyClubOrTeamMaintenance(actor.id, input("club", club.id, 2, "reactivate"));
      assert.equal((await db.teams.findUniqueOrThrow({ where: { id: team.id } })).status, "INACTIVE");
      await db.$transaction(tx => assertPermission(tx, actor.id, { module: "clubs", action: "CREATE", context: { clubId: club.id } }));
    });
    await t.test("dos cambios concurrentes de la misma versión solo confirman uno", async () => {
      const results = await Promise.allSettled([1, 2].map(() => applyClubOrTeamMaintenance(actor.id, input("team", team.id, 2, "reactivate"))));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(results.filter(result => result.status === "rejected").length, 1);
      assert.equal((await db.teams.findUniqueOrThrow({ where: { id: team.id } })).version, 3);
    });
    await t.test("corrección de nombre conserva identidad y rechaza duplicados normalizados", async () => {
      await db.teams.create({ data: { club_id: club.id, reference_number: randomUUID(), name: "Otro equipo" } });
      const clean = await db.teams.create({ data: { club_id: club.id, reference_number: randomUUID(), name: "Nombre por corregir" } });
      await assert.rejects(applyClubOrTeamMaintenance(actor.id, { ...input("team", clean.id, 1, "edit"), name: " OTRO   equipo " }), /DUPLICATE/);
      await applyClubOrTeamMaintenance(actor.id, { ...input("team", clean.id, 1, "edit"), name: "Nombre corregido" });
      assert.equal((await db.teams.findUniqueOrThrow({ where: { id: clean.id } })).reference_number, clean.reference_number);
      await assert.rejects(applyClubOrTeamMaintenance(actor.id, { ...input("club", club.id, 3, "edit"), name: "Cambio histórico" }), /FORMAL_CHANGE_REQUIRED/);
    });
    await t.test("confirmación y motivo se exigen también en servidor", async () => {
      await assert.rejects(applyClubOrTeamMaintenance(actor.id, { ...input("club", club.id, 3, "deactivate"), confirmed: false }), /INVALID_INPUT/);
      await assert.rejects(applyClubOrTeamMaintenance(actor.id, { ...input("club", club.id, 3, "deactivate"), reason: "" }), /INVALID_INPUT/);
    });
    await t.test("eliminación bloqueada por referencias y por historial administrativo", async () => {
      await assert.rejects(applyClubOrTeamMaintenance(actor.id, input("club", club.id, 3, "delete")), /HAS_REFERENCES/);
      await assert.rejects(applyClubOrTeamMaintenance(actor.id, input("team", team.id, 3, "delete")), /HAS_REFERENCES/);
      assert.ok(await db.clubs.findUnique({ where: { id: club.id } }));
      assert.ok(await db.teams.findUnique({ where: { id: team.id } }));
    });
    await t.test("elimina solo registros vacíos con una auditoría permanente; carrera no duplica", async () => {
      for (const kind of ["club", "team"] as const) {
        const row = kind === "club"
          ? await db.clubs.create({ data: { league_id: league.id, name: "Club vacío", reference_number: randomUUID() } })
          : await db.teams.create({ data: { club_id: club.id, name: "Equipo vacío", reference_number: randomUUID() } });
        const results = await Promise.allSettled([1, 2].map(() => applyClubOrTeamMaintenance(actor.id, input(kind, row.id, 1, "delete"))));
        assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
        const exists = kind === "club" ? await db.clubs.findUnique({ where: { id: row.id } }) : await db.teams.findUnique({ where: { id: row.id } });
        assert.equal(exists, null);
        const events = await db.audit_logs.findMany({ where: { entity_id: row.id, action: "DELETE" } });
        assert.equal(events.length, 1); assert.equal(events[0].user_id, actor.id);
      }
    });
    await t.test("APPROVE limitado a club no concede eliminación definitiva", async () => {
      const p = await db.people.create({ data: { first_name: "Delegado", paternal_surname: "Sintético" } });
      const delegate = await db.users.create({ data: { person_id: p.id, username: randomUUID(), email: `${randomUUID()}@example.test`, password_hash: "unused", must_change_password: false } });
      await db.$transaction(async tx => {
        await lockAuthorization(tx, "exclusive");
        await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', 'Fixture de permiso limitado', true)`;
        await tx.user_roles.create({ data: { user_id: delegate.id, role_id: role.id, club_id: club.id, league_id: league.id } });
      });
      const empty = await db.teams.create({ data: { club_id: club.id, name: "Vacío delegado", reference_number: randomUUID() } });
      await assert.rejects(applyClubOrTeamMaintenance(delegate.id, input("team", empty.id, 1, "delete")), /FORBIDDEN/);
      assert.ok(await db.teams.findUnique({ where: { id: empty.id } }));
    });
    await t.test("fallo de auditoría revierte tanto la baja como la eliminación", async () => {
      const empty = await db.teams.create({ data: { club_id: club.id, name: "Rollback", reference_number: randomUUID() } });
      await db.$executeRaw`CREATE FUNCTION sports_management.pd122_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PD122 forced audit failure'; END $$`;
      await db.$executeRaw`CREATE TRIGGER pd122_fail_audit BEFORE INSERT ON sports_management.audit_logs
        FOR EACH ROW WHEN (NEW.reason = 'PD122 audit rollback') EXECUTE FUNCTION sports_management.pd122_fail_audit()`;
      try {
        for (const operation of ["deactivate", "delete"]) {
          await assert.rejects(applyClubOrTeamMaintenance(actor.id, { ...input("team", empty.id, 1, operation), reason: "PD122 audit rollback" }));
          const row = await db.teams.findUniqueOrThrow({ where: { id: empty.id } });
          assert.equal(row.status, "ACTIVE"); assert.equal(row.version, 1);
          assert.equal(await db.audit_logs.count({ where: { entity_id: empty.id } }), 0);
        }
      } finally {
        await db.$executeRaw`DROP TRIGGER pd122_fail_audit ON sports_management.audit_logs`;
        await db.$executeRaw`DROP FUNCTION sports_management.pd122_fail_audit()`;
      }
    });
  } finally { await db.$disconnect(); }
});
