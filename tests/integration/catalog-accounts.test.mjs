import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import pg from 'pg';
import { tsImport } from 'tsx/esm/api';
import { Browser } from './auth.test.mjs';

/** RF22 real, antes de las suites con concesiones aisladas, en la base del harness. */
export async function runCatalogAccountIntegrationSuite({ databaseUrl, baseUrl, onAdministrator }) {
  const target = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search, '');
  assert.equal(target.hash, '');
  const { loadPermissionCatalog } = await tsImport('../../prisma/permissions-catalog.ts', import.meta.url);
  const { PERMISSION_ROLE_CODES } = await tsImport('../../prisma/permissions-data.ts', import.meta.url);
  const { seedPermissionDatabase, MATRIX_INSTALLATION } = await tsImport('../../prisma/seed-permissions.ts', import.meta.url);
  const catalog = await loadPermissionCatalog();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const environment = { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, NODE_ENV: 'test' };
  const fixtureUsers = [];
  let fixtureActor;
  let installed = false;
  const password = `Initial-${randomBytes(20).toString('hex')}!aA`;
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  async function audited(work) {
    await db.query('BEGIN');
    try {
      await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.reason','PDGLD-54: fixtures y limpieza de integración RF22 real',true)", [fixtureActor]);
      await work();
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  }
  async function fixture(role, leagueId = null, clubId = null) {
    const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Sintético','Catálogo RF22') RETURNING id")).rows[0].id;
    const email = `catalog-${randomUUID()}@example.test`;
    const user = (await db.query(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
      VALUES ($1,$2,$2,$3,false) RETURNING id`, [person, email, hash])).rows[0];
    fixtureUsers.push(user.id);
    fixtureActor ??= user.id;
    await audited(() => db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id)
      SELECT $1,id,$3,$4 FROM sports_management.roles WHERE code=$2`, [user.id, role, leagueId, clubId]));
    const browser = new Browser(baseUrl);
    assert.equal((await browser.login(email, password)).searchParams.has('error'), false);
    return { ...user, browser };
  }
  function payload(leagueId, extra = {}) {
    const suffix = randomUUID().replaceAll('-', '');
    return { username: `catalog_${suffix}`, email: `catalog-${suffix}@example.test`,
      temporaryPassword: `Temporary-${randomBytes(18).toString('hex')}!aA`,
      person: { firstName: 'Persona sintética', paternalSurname: 'Catálogo' },
      roles: ['SECRETARY'], leagueId, ...extra };
  }
  function create(browser, body) {
    return browser.request('/api/accounts', { method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify(body) });
  }
  function patch(browser, roleCode, permissionId, granted, reason) {
    return browser.request('/api/permissions', { method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ roleCode, permissionId, granted, ...(granted ? { contextOnly: false } : {}), reason }) });
  }
  async function counts() {
    return (await db.query(`SELECT
      (SELECT count(*)::int FROM sports_management.people) people,
      (SELECT count(*)::int FROM sports_management.users) users,
      (SELECT count(*)::int FROM sports_management.user_roles) assignments,
      (SELECT count(*)::int FROM sports_management.role_permissions) grants,
      (SELECT count(*)::int FROM sports_management.audit_logs) audit`)).rows[0];
  }
  async function forbidden(browser, body) {
    const before = await counts();
    const response = await create(browser, body);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { code: 'FORBIDDEN' });
    assert.deepEqual(await counts(), before, 'La denegación no escribe personas, cuentas, asignaciones ni auditoría.');
  }
  async function withRevokedUserAction(action, work) {
    const grant = (await db.query(`SELECT rp.* FROM sports_management.role_permissions rp
      JOIN sports_management.roles r ON r.id=rp.role_id JOIN sports_management.permissions p ON p.id=rp.permission_id
      WHERE r.code='SUPERADMIN' AND p.module='users' AND p.action=$1`, [action])).rows[0];
    assert.ok(grant, 'La concesión procede del catálogo real instalado.');
    await audited(() => db.query('DELETE FROM sports_management.role_permissions WHERE id=$1', [grant.id]));
    try { await work(); }
    finally {
      // Restaurar exclusivamente el fixture revocado permite aislar el siguiente caso.
      await audited(() => db.query(`INSERT INTO sports_management.role_permissions(id,role_id,permission_id,context_only)
        VALUES ($1,$2,$3,$4)`, [grant.id, grant.role_id, grant.permission_id, grant.context_only]));
    }
  }
  try {
    await test('PDGLD-54: catálogo RF22 real integrado con cuentas y sesiones actuales', { timeout: 240_000 }, async (t) => {
      await t.test('el export aprobado instala exactamente 127 concesiones y los 12 códigos oficiales', async () => {
        assert.equal(catalog.length, 127);
        assert.equal(PERMISSION_ROLE_CODES.length, 12);
        assert.ok(catalog.every((grant) => PERMISSION_ROLE_CODES.includes(grant.roleCode)));
        assert.equal((await seedPermissionDatabase(prisma, catalog, environment)).installed, true);
        installed = true;
        assert.deepEqual((await db.query('SELECT code FROM sports_management.roles ORDER BY code')).rows.map((role) => role.code), [...PERMISSION_ROLE_CODES].sort());
        assert.equal(await prisma.user_roles.count({ where: { roles: { code: 'GUEST' } } }), 0);
        const actual = (await db.query(`SELECT r.code AS "roleCode",p.module,p.action,rp.context_only AS "contextOnly"
          FROM sports_management.role_permissions rp JOIN sports_management.roles r ON r.id=rp.role_id
          JOIN sports_management.permissions p ON p.id=rp.permission_id`)).rows;
        const comparable = (grants) => grants.map(({ roleCode, module, action, contextOnly }) =>
          JSON.stringify({ roleCode, module, action, contextOnly })).sort();
        assert.deepEqual(comparable(actual), comparable(catalog));
        assert.equal(actual.some((grant) => ['accounts', 'user_roles', 'role_permissions'].includes(grant.module)), false);
        const marker = (await db.query('SELECT new_data FROM sports_management.audit_logs WHERE id=$1', [MATRIX_INSTALLATION.id])).rows[0];
        assert.equal(marker.new_data.grantCount, 127);
      });

      const leagueA = (await db.query('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [`Catálogo A ${randomUUID()}`])).rows[0].id;
      const leagueB = (await db.query('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [`Catálogo B ${randomUUID()}`])).rows[0].id;
      const clubs = [];
      for (const leagueId of [leagueA, leagueA, leagueB])
        clubs.push((await db.query('INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES ($1,$2,$3) RETURNING id',
          [leagueId, randomUUID(), 'Club sintético RF22'])).rows[0].id);
      const admin = await fixture('SUPERADMIN');
      if (onAdministrator) await onAdministrator(admin);
      const scoped = await fixture('SUPERADMIN', leagueA);
      const clubScoped = await fixture('SUPERADMIN', leagueA, clubs[0]);

      await t.test('users READ/CREATE/UPDATE/APPROVE permiten opciones privadas y alta del rol real SCHEDULER', async () => {
        const response = await admin.browser.request(`/api/accounts?leagueId=${leagueA}`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control'), /private.*no-store/);
        const options = await response.json();
        assert.deepEqual(Object.keys(options).sort(), ['clubs', 'leagues', 'roles']);
        assert.ok(options.roles.some((role) => role.code === 'SCHEDULER'));
        assert.ok(options.clubs.some((club) => club.id === clubs[0]));
        assert.ok(!options.clubs.some((club) => club.id === clubs[2]));
        const createdResponse = await create(admin.browser, payload(leagueA, { roles: ['SCHEDULER'] }));
        assert.equal(createdResponse.status, 201);
        const created = await createdResponse.json();
        fixtureUsers.push(created.id);
        assert.equal(created.mustChangePassword, true);
        assert.deepEqual(created.assignments.map((assignment) => assignment.role), ['SCHEDULER']);
      });

      await t.test('el alta real conserva cambio obligatorio, invalidación de sesión anterior y cierre', async () => {
        const input = payload(leagueA);
        const response = await create(admin.browser, input);
        assert.equal(response.status, 201);
        const created = await response.json();
        fixtureUsers.push(created.id);
        const browser = new Browser(baseUrl);
        assert.equal((await browser.login(input.email, input.temporaryPassword)).searchParams.has('error'), false);
        await browser.assertAccess(403, 'PASSWORD_CHANGE_REQUIRED');
        const version = (await db.query('SELECT version FROM sports_management.users WHERE id=$1', [created.id])).rows[0].version;
        const nextPassword = `Changed-${randomBytes(18).toString('hex')}!aA`;
        const changed = await browser.request('/api/auth/change-password', { method: 'POST',
          headers: { 'content-type': 'application/json', origin: baseUrl },
          body: JSON.stringify({ currentPassword: input.temporaryPassword, newPassword: nextPassword, confirmPassword: nextPassword }) });
        assert.equal(changed.status, 200);
        assert.equal((await db.query('SELECT version FROM sports_management.users WHERE id=$1', [created.id])).rows[0].version, version + 1);
        await browser.assertAccess(401, 'UNAUTHENTICATED');
        assert.equal((await browser.login(input.email, nextPassword)).searchParams.has('error'), false);
        await browser.assertAccess(200);
        await forbidden(browser, payload(leagueA));
        const csrfToken = await browser.csrf();
        assert.equal((await browser.request('/api/auth/signout', { method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ csrfToken, callbackUrl: '/login', json: 'true' }) })).status, 200);
        await browser.assertAccess(401, 'UNAUTHENTICATED');
      });

      await t.test('las asignaciones reales conservan liga y club sin mezclar sus contextos', async () => {
        const scopedResponse = await scoped.browser.request(`/api/accounts?leagueId=${leagueA}`);
        assert.equal(scopedResponse.status, 200);
        assert.deepEqual((await scopedResponse.json()).leagues.map((league) => league.id), [leagueA]);
        assert.equal((await scoped.browser.request(`/api/accounts?leagueId=${leagueB}`)).status, 403);
        await forbidden(scoped.browser, payload(leagueB));
        assert.equal((await scoped.browser.request('/api/permissions')).status, 403);
        const clubResponse = await clubScoped.browser.request(`/api/accounts?leagueId=${leagueA}`);
        assert.equal(clubResponse.status, 200);
        const options = await clubResponse.json();
        assert.deepEqual(options.clubs.map((club) => club.id), [clubs[0]]);
        assert.deepEqual(options.roles.map((role) => role.code), ['CLUB_DELEGATE']);
        const body = (clubId) => payload(leagueA, { roles: ['CLUB_DELEGATE'], club: { kind: 'existing', id: clubId } });
        const permitted = await create(clubScoped.browser, body(clubs[0]));
        assert.equal(permitted.status, 201);
        fixtureUsers.push((await permitted.json()).id);
        await forbidden(clubScoped.browser, body(clubs[1]));
        await forbidden(clubScoped.browser, payload(leagueA));
      });

      await t.test('administrar programación mediante APPROVE no concede CREATE de programación al actor', async () => {
        const schedulingCreate = (await db.query("SELECT id FROM sports_management.permissions WHERE module='scheduling' AND action='CREATE'")).rows[0].id;
        const hasSchedulingCreate = async () => (await db.query(`SELECT count(*)::int n FROM sports_management.user_roles ur
          JOIN sports_management.role_permissions rp ON rp.role_id=ur.role_id
          JOIN sports_management.permissions p ON p.id=rp.permission_id
          WHERE ur.user_id=$1 AND p.module='scheduling' AND p.action='CREATE'`, [admin.id])).rows[0].n;
        assert.equal(await hasSchedulingCreate(), 0, 'RF22 no concede programar al SUPERADMIN.');
        const reason = `PDGLD-54 RF22: administración operativa ${randomUUID()}`;
        for (const granted of [false, true]) {
          const response = await patch(admin.browser, 'SCHEDULER', schedulingCreate, granted, reason);
          assert.equal(response.status, 200);
          assert.equal((await response.json()).changed, true);
          assert.equal(await hasSchedulingCreate(), 0);
        }
        const events = (await db.query('SELECT user_id,action,table_name FROM sports_management.audit_logs WHERE reason=$1 ORDER BY occurred_at,id', [reason])).rows;
        assert.equal(events.length, 2, 'Una auditoría del trigger por modificación, sin eventos duplicados.');
        assert.deepEqual(events.map((event) => event.action).sort(), ['DELETE', 'INSERT']);
        assert.ok(events.every((event) => event.user_id === admin.id && event.table_name === 'role_permissions'));
        await withRevokedUserAction('APPROVE', async () => {
          await forbidden(admin.browser, payload(leagueA, { roles: ['SCHEDULER'] }));
        });
      });

      await t.test('CREATE no basta para conceder autoridad: sin UPDATE el alta se deniega', async () => {
        await withRevokedUserAction('UPDATE', async () => {
          await forbidden(admin.browser, payload(leagueA));
          assert.equal((await admin.browser.request('/api/accounts')).status, 200);
          assert.equal((await admin.browser.session()).user.id, admin.id);
        });
      });

      await t.test('revocar READ o CREATE afecta la siguiente petición con la misma sesión SUPERADMIN', async () => {
        await withRevokedUserAction('READ', async () => {
          assert.equal((await admin.browser.request('/api/accounts')).status, 403);
          assert.equal((await admin.browser.request('/api/permissions')).status, 403);
          assert.equal((await admin.browser.session()).user.id, admin.id);
        });
        await withRevokedUserAction('CREATE', async () => {
          await forbidden(admin.browser, payload(leagueA));
          await admin.browser.assertAccess(200);
          assert.equal((await admin.browser.request('/api/accounts')).status, 200);
          const before = await counts();
          assert.equal((await seedPermissionDatabase(prisma, catalog, environment)).installed, false);
          assert.deepEqual(await counts(), before, 'Repetir permissions no restaura la revocación ni añade auditoría.');
          await forbidden(admin.browser, payload(leagueA));
          assert.equal((await admin.browser.session()).user.id, admin.id);
        });
      });

      await t.test('el último gestor global del catálogo no puede eliminarse y la escritura se revierte completa', async () => {
        const update = (await db.query("SELECT id FROM sports_management.permissions WHERE module='users' AND action='UPDATE'")).rows[0].id;
        const before = await counts();
        const response = await patch(admin.browser, 'SUPERADMIN', update, false, `PDGLD-54 RF22 último gestor ${randomUUID()}`);
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { code: 'LAST_PERMISSION_MANAGER' });
        assert.deepEqual(await counts(), before, 'La concesión y su auditoría se revierten juntas.');
        assert.equal((await admin.browser.request('/api/permissions')).status, 200);
      });
    });
  } finally {
    try {
      if (fixtureActor) await audited(async () => {
        // Las otras suites ejercitan concesiones aisladas. Limpiar exclusivamente
        // las claves instaladas aquí y nuestras asignaciones; el historial queda.
        if (installed) await db.query(`DELETE FROM sports_management.role_permissions rp
          USING sports_management.roles r,sports_management.permissions p
          WHERE rp.role_id=r.id AND rp.permission_id=p.id AND (r.code,p.module,p.action) IN (
            SELECT x."roleCode",x.module,x.action FROM jsonb_to_recordset($1::jsonb)
              AS x("roleCode" text,module text,action text))`, [JSON.stringify(catalog)]);
        await db.query('DELETE FROM sports_management.user_roles WHERE user_id=ANY($1::uuid[])', [fixtureUsers]);
      });
    } finally {
      await prisma.$disconnect();
      await db.end();
    }
  }
}
