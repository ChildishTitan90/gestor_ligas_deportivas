import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import * as argon2 from 'argon2';
import { Browser } from './auth.test.mjs';

/** Fixtures aislados de PDGLD-54; no constituyen la matriz RF22 aprobada. */
export async function runPermissionAdministrationSuite({ databaseUrl, baseUrl }) {
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  let previous = [];
  let originalCaptured = false;
  let fixtureActor;
  const fixturePermissionIds = [];
  try {
    const password = `Initial-${randomBytes(20).toString('hex')}!aA`;
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const roles = new Map((await db.query('SELECT code,id FROM sports_management.roles')).rows.map((role) => [role.code, role.id]));
    async function permission(module, action) {
      const created = (await db.query(`INSERT INTO sports_management.permissions(module,action) VALUES ($1,$2)
        ON CONFLICT (module,action) DO NOTHING RETURNING id`, [module, action])).rows[0];
      if (created) {
        if (module !== 'role_permissions') fixturePermissionIds.push(created.id);
        return created.id;
      }
      return (await db.query('SELECT id FROM sports_management.permissions WHERE module=$1 AND action=$2', [module, action])).rows[0].id;
    }
    const read = await permission('role_permissions', 'READ');
    const update = await permission('role_permissions', 'UPDATE');
    const approve = await permission('role_permissions', 'APPROVE');
    const demonstrable = await permission(`fixture_admin_${randomUUID()}`, 'READ');
    const unowned = await permission(`fixture_unowned_${randomUUID()}`, 'CREATE');
    const controlUnowned = await permission('user_roles', 'APPROVE');
    const league = (await db.query('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [`Gestión sintética ${randomUUID()}`])).rows[0].id;
    async function fixture(role, leagueId = null, restricted = false, expires = false) {
      const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Sintético','Permisos') RETURNING id")).rows[0].id;
      const email = `permissions-${randomUUID()}@example.test`;
      const user = (await db.query(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
        VALUES ($1,$2,$2,$3,$4) RETURNING id`, [person, email, hash, restricted])).rows[0];
      await auditFixture(user.id, async () => {
        await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,ends_at)
          VALUES ($1,$2,$3,CASE WHEN $4 THEN clock_timestamp()+interval '1 day' ELSE NULL END)`, [user.id, roles.get(role), leagueId, expires]);
      });
      const browser = new Browser(baseUrl);
      const login = await browser.login(email, password);
      assert.equal(login.searchParams.has('error'), false);
      return { ...user, browser, role };
    }
    async function auditFixture(actor, operation) {
      await db.query('BEGIN');
      try {
        await db.query("SELECT set_config('app.user_id',$1,true), set_config('app.reason','Fixture aislado PDGLD-54: administración',true)", [actor]);
        await operation();
        await db.query('COMMIT');
      } catch (error) { await db.query('ROLLBACK'); throw error; }
    }
    const managerA = await fixture('REFEREE_MANAGER');
    fixtureActor = managerA.id;
    const managerB = await fixture('SCHEDULER');
    const scoped = await fixture('DATA_ENTRY', league);
    const superadmin = await fixture('SUPERADMIN');
    const restricted = await fixture('REFEREE', null, true);
    const temporary = await fixture('EXECUTIVE_PRESIDENT', null, false, true);
    previous = (await db.query(`SELECT rp.* FROM sports_management.role_permissions rp
      JOIN sports_management.permissions p ON p.id=rp.permission_id WHERE p.module='role_permissions'`)).rows;
    originalCaptured = true;
    await auditFixture(managerA.id, async () => {
      // La base es temporal propia. Aislar gestores anteriores para comprobar
      // que la última autoridad real no desaparezca por dos peticiones paralelas.
      await db.query(`DELETE FROM sports_management.role_permissions rp USING sports_management.permissions p
        WHERE rp.permission_id=p.id AND p.module='role_permissions'`);
      for (const role of ['REFEREE_MANAGER', 'SCHEDULER', 'DATA_ENTRY', 'REFEREE', 'EXECUTIVE_PRESIDENT']) {
        for (const permissionId of [read, update])
          await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,false)', [roles.get(role), permissionId]);
      }
      await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,false)', [roles.get(managerA.role), demonstrable]);
      await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,ends_at)
        VALUES ($1,$2,clock_timestamp()+interval '1 day')`, [managerB.id, roles.get('SECRETARY')]);
      await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,false)', [roles.get('SECRETARY'), demonstrable]);
    });
    const reason = `Revisión sintética PDGLD-54 ${randomUUID()}`;
    function patch(browser, roleCode, permissionId, granted, contextOnly, overrides = {}) {
      return browser.request('/api/permissions', {
        method: 'PATCH', headers: { 'content-type': 'application/json', origin: baseUrl, ...overrides },
        body: JSON.stringify({ roleCode, permissionId, granted, ...(granted ? { contextOnly } : {}), reason }),
      });
    }
    async function auditCount() {
      return (await db.query('SELECT count(*)::int count FROM sports_management.audit_logs WHERE reason=$1', [reason])).rows[0].count;
    }
    await test('PDGLD-54: administración atómica de permisos con PostgreSQL real', { timeout: 120_000 }, async (t) => {
      await t.test('protege lectura/escritura: anónimo, SUPERADMIN sin permiso, ámbito local y sesión restringida', async () => {
        for (const [browser, status] of [[new Browser(baseUrl), 401], [superadmin.browser, 403], [scoped.browser, 403], [restricted.browser, 403]]) {
          assert.equal((await browser.request('/api/permissions')).status, status);
          assert.equal((await patch(browser, 'PLAYER', demonstrable, true, true)).status, status);
        }
        assert.equal(await auditCount(), 0);
      });
      await t.test('consulta catálogo mínimo con filtro y caché privada', async () => {
        const response = await managerA.browser.request('/api/permissions?roleCode=SUPERADMIN');
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control'), /private.*no-store/);
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ['assignments', 'permissions', 'roles']);
        assert.deepEqual(body.roles.map((role) => role.code), ['SUPERADMIN']);
        assert.ok(body.assignments.every((assignment) => assignment.roleCode === 'SUPERADMIN'));
        assert.ok(!JSON.stringify(body).includes('password_hash'));
        assert.equal((await managerA.browser.request('/api/permissions?roleCode=unknown')).status, 400);
      });
      await t.test('rechaza escalamiento sobre rol propio y ajeno sin cambios ni auditoría', async () => {
        for (const role of [managerA.role, 'SUPERADMIN'])
          assert.equal((await patch(managerA.browser, role, unowned, true, false)).status, 403);
        assert.equal(await auditCount(), 0);
      });
      await t.test('una delegación temporal permite consultar pero no crear autoridad permanente', async () => {
        assert.equal((await temporary.browser.request('/api/permissions')).status, 200);
        assert.equal((await patch(temporary.browser, 'PLAYER', read, true, false)).status, 403);
        // B administra permanentemente, pero solo tiene este permiso objetivo
        // mediante otro vínculo temporal. No puede convertirlo en permanente.
        assert.equal((await patch(managerB.browser, 'PLAYER', demonstrable, true, true)).status, 403);
        assert.equal(await auditCount(), 0);
      });
      await t.test('valida origen, contrato, límites y entradas del catálogo', async () => {
        assert.equal((await patch(managerA.browser, 'PLAYER', demonstrable, true, true, { origin: 'https://externo.example' })).status, 403);
        assert.equal((await patch(managerA.browser, 'PLAYER', demonstrable, true, true, { origin: '' })).status, 403);
        assert.equal((await patch(managerA.browser, 'PLAYER', demonstrable, true, true, { 'sec-fetch-site': 'cross-site' })).status, 403);
        assert.equal((await patch(managerA.browser, 'PLAYER', demonstrable, true, true, { 'content-type': 'text/plain' })).status, 400);
        assert.equal((await patch(managerA.browser, 'UNKNOWN_ROLE', demonstrable, true, true)).status, 400);
        assert.equal((await patch(managerA.browser, 'PLAYER', randomUUID(), true, true)).status, 400);
        for (const body of [
          { roleCode: 'PLAYER', permissionId: demonstrable, granted: true, reason },
          { roleCode: 'PLAYER', permissionId: demonstrable, granted: true, contextOnly: true, reason: 'corto' },
          { roleCode: 'PLAYER', permissionId: demonstrable, granted: false, reason, actorId: managerA.id },
        ]) assert.equal((await managerA.browser.request('/api/permissions', {
          method: 'PATCH', headers: { origin: baseUrl, 'content-type': 'application/json' }, body: JSON.stringify(body),
        })).status, 400);
        assert.equal((await managerA.browser.request('/api/permissions', {
          method: 'PATCH', headers: { origin: baseUrl, 'content-type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(9_000) }),
        })).status, 413);
        assert.equal(await auditCount(), 0);
      });
      await t.test('concede, ajusta y retira un vínculo; audita exactamente una vez por cambio con actor y motivo', async () => {
        assert.equal((await patch(managerA.browser, 'PLAYER', demonstrable, true, false)).status, 200);
        const assignment = (await db.query('SELECT id FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [roles.get('PLAYER'), demonstrable])).rows[0];
        assert.equal(await auditCount(), 1);
        const repeated = await patch(managerA.browser, 'PLAYER', demonstrable, true, false);
        assert.equal(repeated.status, 200);
        assert.equal((await repeated.json()).changed, false);
        assert.equal(await auditCount(), 1);
        assert.equal((await patch(managerA.browser, 'PLAYER', demonstrable, true, true)).status, 200);
        assert.equal((await patch(managerA.browser, 'PLAYER', demonstrable, false)).status, 200);
        const events = (await db.query('SELECT user_id,action,previous_data,new_data FROM sports_management.audit_logs WHERE reason=$1 AND entity_id=$2 ORDER BY occurred_at', [reason, assignment.id])).rows;
        assert.deepEqual(events.map((event) => event.action), ['INSERT', 'UPDATE', 'DELETE']);
        assert.ok(events.every((event) => event.user_id === managerA.id));
        assert.equal(events[1].previous_data.context_only, false);
        assert.equal(events[1].new_data.context_only, true);
      });
      await t.test('aplica concesión y revocación de SUPERADMIN con la misma sesión sin bypass', async () => {
        assert.equal((await patch(managerA.browser, 'SUPERADMIN', read, true, false)).status, 200);
        assert.equal((await superadmin.browser.request('/api/permissions')).status, 200);
        assert.equal((await patch(managerA.browser, 'SUPERADMIN', read, false)).status, 200);
        assert.equal((await superadmin.browser.request('/api/permissions')).status, 403);
      });
      await t.test('APPROVE autoriza gestión operativa y su revocación se aplica en la misma sesión; no concede autoridad administrativa', async () => {
        await auditFixture(managerA.id, async () => {
          await db.query('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES ($1,$2,false)', [roles.get(managerA.role), approve]);
        });
        assert.equal((await patch(managerA.browser, 'PLAYER', unowned, true, false)).status, 200);
        for (const role of [managerA.role, 'SUPERADMIN'])
          assert.equal((await patch(managerA.browser, role, controlUnowned, true, false)).status, 403);
        await auditFixture(managerA.id, async () => {
          await db.query('DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2', [roles.get(managerA.role), approve]);
        });
        assert.equal((await patch(managerA.browser, 'SUPERADMIN', unowned, true, false)).status, 403);
        assert.equal((await patch(managerA.browser, 'PLAYER', unowned, false)).status, 200);
      });
      await t.test('dos revocaciones simultáneas conservan un gestor y revierten auditoría de la rechazada', async () => {
        const before = await auditCount();
        const responses = await Promise.all([
          patch(managerA.browser, managerB.role, read, false),
          patch(managerB.browser, managerA.role, read, false),
        ]);
        assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
        const rejected = responses.find((response) => response.status === 409);
        assert.deepEqual(await rejected.json(), { code: 'LAST_PERMISSION_MANAGER' });
        assert.equal(await auditCount(), before + 1);
        const retained = (await db.query(`SELECT rp.role_id FROM sports_management.role_permissions rp
          WHERE rp.permission_id=$1 AND rp.role_id IN ($2,$3)`, [read, roles.get(managerA.role), roles.get(managerB.role)])).rows;
        assert.equal(retained.length, 1);
        const remaining = retained[0].role_id === roles.get(managerA.role) ? managerA : managerB;
        const final = await patch(remaining.browser, remaining.role, update, false);
        assert.equal(final.status, 409);
        assert.deepEqual(await final.json(), { code: 'LAST_PERMISSION_MANAGER' });
        assert.equal(await auditCount(), before + 1);
      });
    });
  } finally {
    try {
      if (originalCaptured && fixtureActor) {
        await db.query('BEGIN');
        try {
          await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.reason','Restauración fixtures aislados PDGLD-54',true)", [fixtureActor]);
          await db.query(`DELETE FROM sports_management.role_permissions WHERE permission_id IN
            (SELECT id FROM sports_management.permissions WHERE module='role_permissions')`);
          for (const assignment of previous)
            await db.query('INSERT INTO sports_management.role_permissions(id,role_id,permission_id,context_only) VALUES ($1,$2,$3,$4)', [assignment.id, assignment.role_id, assignment.permission_id, assignment.context_only]);
          await db.query('DELETE FROM sports_management.role_permissions WHERE permission_id=ANY($1::uuid[])', [fixturePermissionIds]);
          await db.query('DELETE FROM sports_management.permissions WHERE id=ANY($1::uuid[])', [fixturePermissionIds]);
          await db.query('COMMIT');
        } catch (error) { await db.query('ROLLBACK'); throw error; }
      }
    } finally { await db.end(); }
  }
}
