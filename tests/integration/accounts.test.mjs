import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import * as argon2 from 'argon2';
import { Browser } from './auth.test.mjs';

export async function runAccountIntegrationSuite({ databaseUrl, baseUrl }) {
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const password = `Tmp-${randomBytes(20).toString('hex')}!aA`;
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  try {
    const leagueA = (await db.query("INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id", [`Prueba A ${randomUUID()}`])).rows[0].id;
    const leagueB = (await db.query("INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id", [`Prueba B ${randomUUID()}`])).rows[0].id;
    const clubs = [];
    for (const league of [leagueA, leagueB]) {
      clubs.push((await db.query("INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES ($1,$2,$3) RETURNING id",
        [league, randomUUID(), 'Club sintético'])).rows[0].id);
    }
    async function fixture(kind, role, scope, restricted = false, club = null) {
      const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Sintético','Cuentas') RETURNING id")).rows[0].id;
      const email = `${kind}-${randomUUID()}@example.test`;
      const user = (await db.query(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
        VALUES ($1,$2,$2,$3,$4) RETURNING id`, [person, email, hash, restricted])).rows[0];
      if (role) {
        await db.query('BEGIN');
        try {
          await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.reason','Fixture sintético PDGLD-34',true)", [user.id]);
          await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id)
            SELECT $1,id,$3,$4 FROM sports_management.roles WHERE code=$2`, [user.id, role, scope, club]);
          await db.query('COMMIT');
        } catch (error) { await db.query('ROLLBACK'); throw error; }
      }
      const browser = new Browser(baseUrl);
      const result = await browser.login(email, password);
      assert.ok(!result.searchParams.get('error'), 'Debe autenticar el fixture sintético.');
      return { ...user, email, browser };
    }
    const admin = await fixture('admin', 'SUPERADMIN', null);
    await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-54: concesiones aisladas de prueba, no matriz RF22',false)", [admin.id]);
    for (const [module, action] of [['users', 'READ'], ['users', 'CREATE'], ['users', 'UPDATE'], ['clubs', 'CREATE']]) {
      await db.query(`INSERT INTO sports_management.permissions(module,action) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [module, action]);
      await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
        SELECT r.id,p.id,false FROM sports_management.roles r,sports_management.permissions p
        WHERE r.code='SUPERADMIN' AND p.module=$1 AND p.action=$2 ON CONFLICT(role_id,permission_id) DO NOTHING`, [module, action]);
    }
    const ordinary = await fixture('secretario', 'SECRETARY', leagueA);
    const restricted = await fixture('temporal', 'SUPERADMIN', null, true);
    const scoped = await fixture('scoped', 'SUPERADMIN', leagueB);

    function payload(extra = {}) {
      const suffix = randomUUID().replaceAll('-', '');
      return {
        username: `prueba_${suffix}`,
        email: `cuenta-${suffix}@example.test`,
        temporaryPassword: `Inicial-${randomBytes(18).toString('hex')}!aA`,
        person: { firstName: 'Nombre sintético', paternalSurname: 'Cuenta', maternalSurname: 'Prueba' },
        roles: ['SECRETARY'], leagueId: leagueA, ...extra,
      };
    }
    function post(browser, body, headers = {}) {
      return browser.request('/api/accounts', {
        method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl, ...headers },
        body: JSON.stringify(body),
      });
    }
    async function totals() {
      const result = await db.query(`SELECT
        (SELECT count(*)::int FROM sports_management.users) users,
        (SELECT count(*)::int FROM sports_management.people) people,
        (SELECT count(*)::int FROM sports_management.clubs) clubs,
        (SELECT count(*)::int FROM sports_management.user_roles) roles,
        (SELECT count(*)::int FROM sports_management.audit_logs) audit`);
      return result.rows[0];
    }
    async function deny(browser, body, status, code) {
      const before = await totals();
      const response = await post(browser, body);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { code });
      assert.deepEqual(await totals(), before, 'Una denegación no debe dejar escrituras.');
    }

    await test('PDGLD-52: provisión autorizada y atómica de cuentas', { timeout: 240_000 }, async (t) => {
      await t.test('deniega anónimo, ausencia de permisos, cuenta restringida y ámbito ajeno', async () => {
        await deny(new Browser(baseUrl), payload(), 401, 'UNAUTHENTICATED');
        await deny(ordinary.browser, payload(), 403, 'FORBIDDEN');
        await deny(restricted.browser, payload(), 403, 'PASSWORD_CHANGE_REQUIRED');
        await deny(scoped.browser, payload(), 403, 'FORBIDDEN');
        const response = await ordinary.browser.request('/api/accounts');
        assert.equal(response.status, 403);
      });

      await t.test('opciones privadas por liga sin datos de personas ni secretos', async () => {
        const response = await admin.browser.request(`/api/accounts?leagueId=${leagueA}`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control'), /private.*no-store/);
        const options = await response.json();
        assert.ok(options.roles.some((role) => role.code === 'CLUB_DELEGATE'));
        assert.ok(!options.roles.some((role) => ['GUEST', 'PLAYER', 'REFEREE'].includes(role.code)));
        assert.ok(options.clubs.some((club) => club.id === clubs[0]));
        assert.ok(!options.clubs.some((club) => club.id === clubs[1]));
        assert.deepEqual(Object.keys(options).sort(), ['clubs', 'leagues', 'roles']);
      });

      await t.test('operador de liga consulta su ámbito y concede solo autoridad cubierta', async () => {
        for (const [module, action] of [['users', 'READ'], ['users', 'CREATE'], ['users', 'UPDATE']]) {
          await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
            SELECT r.id,p.id,true FROM sports_management.roles r,sports_management.permissions p
            WHERE r.code='EXECUTIVE_PRESIDENT' AND p.module=$1 AND p.action=$2 ON CONFLICT DO NOTHING`, [module, action]);
        }
        const local = await fixture('local', 'EXECUTIVE_PRESIDENT', leagueA);
        const response = await local.browser.request('/api/accounts');
        assert.equal(response.status, 200);
        const options = await response.json();
        assert.deepEqual(options.leagues.map((league) => league.id), [leagueA]);
        assert.ok(!options.roles.some((role) => role.code === 'SUPERADMIN'));
        assert.equal((await local.browser.request(`/api/accounts?leagueId=${leagueB}`)).status, 403);
        assert.equal((await post(local.browser, payload())).status, 201);
        await deny(local.browser, payload({ leagueId: leagueB }), 403, 'FORBIDDEN');
        await deny(local.browser, payload({ roles: ['SUPERADMIN'], leagueId: undefined }), 403, 'FORBIDDEN');
        // Poder crear no habilita roles cuyas capacidades no posee, ni altas de clubes.
        await deny(local.browser, payload({ roles: ['CLUB_DELEGATE'], club: { kind: 'new', name: 'Fuera de facultades' } }), 403, 'FORBIDDEN');
        const clubLocal = await fixture('club-local', 'EXECUTIVE_PRESIDENT', leagueA, false, clubs[0]);
        const clubOptions = await clubLocal.browser.request(`/api/accounts?leagueId=${leagueA}`);
        assert.equal(clubOptions.status, 200);
        const filtered = await clubOptions.json();
        assert.deepEqual(filtered.clubs.map((club) => club.id), [clubs[0]]);
        assert.deepEqual(filtered.roles.map((role) => role.code), ['CLUB_DELEGATE']);
        assert.equal((await post(clubLocal.browser, payload({ roles: ['CLUB_DELEGATE'], club: { kind: 'existing', id: clubs[0] } }))).status, 201);
        await deny(clubLocal.browser, payload(), 403, 'FORBIDDEN');
      });

      await t.test('revocar permiso deniega con la misma sesión y SUPERADMIN no tiene bypass', async () => {
        await db.query(`DELETE FROM sports_management.role_permissions rp USING sports_management.roles r,sports_management.permissions p
          WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.code='SUPERADMIN' AND p.module='users' AND p.action='CREATE'`);
        try {
          await deny(admin.browser, payload(), 403, 'FORBIDDEN');
          // READ independiente sigue disponible; no permite crear por sí solo.
          assert.equal((await admin.browser.request('/api/accounts')).status, 200);
        } finally {
          await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
            SELECT r.id,p.id,false FROM sports_management.roles r,sports_management.permissions p
            WHERE r.code='SUPERADMIN' AND p.module='users' AND p.action='CREATE'`);
        }
        assert.equal((await post(admin.browser, payload())).status, 201);
        await db.query(`DELETE FROM sports_management.role_permissions rp USING sports_management.roles r,sports_management.permissions p
          WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.code='SUPERADMIN' AND p.module='users' AND p.action='READ'`);
        try { assert.equal((await admin.browser.request('/api/accounts')).status, 403); }
        finally {
          await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
            SELECT r.id,p.id,false FROM sports_management.roles r,sports_management.permissions p
            WHERE r.code='SUPERADMIN' AND p.module='users' AND p.action='READ'`);
        }
      });

      await t.test('aprobar concesiones permite crear un rol operativo sin heredar su función', async () => {
        const operationalModule = `fixture.accounts.${randomUUID()}`;
        const permission = (await db.query(`INSERT INTO sports_management.permissions(module,action)
          VALUES ($1,'CREATE') RETURNING id`, [operationalModule])).rows[0].id;
        const approve = (await db.query(`INSERT INTO sports_management.permissions(module,action)
          VALUES ('users','APPROVE') ON CONFLICT(module,action) DO UPDATE SET module=EXCLUDED.module RETURNING id`)).rows[0].id;
        await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
          SELECT id,$1,true FROM sports_management.roles WHERE code='SCHEDULER'`, [permission]);
        try {
          await deny(admin.browser, payload({ roles: ['SCHEDULER'] }), 403, 'FORBIDDEN');
          await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
            SELECT id,$1,false FROM sports_management.roles WHERE code='SUPERADMIN'`, [approve]);
          assert.equal((await post(admin.browser, payload({ roles: ['SCHEDULER'] }))).status, 201);
          assert.equal((await db.query(`SELECT count(*)::int n FROM sports_management.role_permissions rp
            JOIN sports_management.roles r ON r.id=rp.role_id WHERE r.code='SUPERADMIN' AND rp.permission_id=$1`, [permission])).rows[0].n, 0);
          await db.query(`DELETE FROM sports_management.role_permissions WHERE permission_id=$1`, [approve]);
          await deny(admin.browser, payload({ roles: ['SCHEDULER'] }), 403, 'FORBIDDEN');
        } finally {
          await db.query('DELETE FROM sports_management.role_permissions WHERE permission_id IN ($1,$2)', [permission, approve]);
        }
      });

      await t.test('rechaza origen externo/ausente, formularios y payload excesivo sin escribir', async () => {
        const before = await totals();
        assert.equal((await post(admin.browser, payload(), { origin: 'https://externo.example' })).status, 403);
        assert.equal((await post(admin.browser, payload(), { origin: '' })).status, 403);
        assert.equal((await post(admin.browser, payload(), { 'sec-fetch-site': 'cross-site' })).status, 403);
        assert.equal((await post(admin.browser, payload(), { 'content-type': 'text/plain' })).status, 400);
        assert.equal((await post(admin.browser, { noise: 'x'.repeat(17_000) })).status, 413);
        assert.deepEqual(await totals(), before);
      });

      await t.test('valida rol/contexto, contraseña, UUID, campos extra y clubes ajenos', async () => {
        for (const body of [
          payload({ roles: ['GUEST'] }), payload({ roles: ['PLAYER'] }),
          payload({ roles: ['SECRETARY', 'SECRETARY'] }),
          payload({ roles: ['CLUB_DELEGATE'] }),
          payload({ roles: ['SUPERADMIN'] }),
          payload({ roles: ['SUPERADMIN', 'SECRETARY'], leagueId: undefined }),
          payload({ roles: ['SECRETARY'], leagueId: undefined }),
          payload({ temporaryPassword: 'debil' }), payload({ leagueId: 'invalid' }),
          payload({ is_active: false }),
        ]) await deny(admin.browser, body, 400, 'VALIDATION_ERROR');
        await deny(admin.browser, payload({ leagueId: randomUUID() }), 400, 'INVALID_CONTEXT');
        await deny(admin.browser, payload({ roles: ['CLUB_DELEGATE'], club: { kind: 'existing', id: clubs[1] } }), 400, 'INVALID_CONTEXT');
      });

      await t.test('crea administrativo, normaliza correo/usuario y exige cambio de contraseña', async () => {
        const input = payload();
        input.email = `  ${input.email.toUpperCase()}  `;
        input.username = input.username.toUpperCase();
        const response = await post(admin.browser, input);
        assert.equal(response.status, 201);
        assert.match(response.headers.get('cache-control'), /no-store/);
        const created = await response.json();
        assert.equal(created.mustChangePassword, true);
        assert.equal(created.clubId, null);
        const row = (await db.query('SELECT username,email,password_hash,must_change_password FROM sports_management.users WHERE id=$1', [created.id])).rows[0];
        assert.equal(row.email, input.email.trim().toLowerCase());
        assert.equal(row.username, input.username.toLowerCase());
        assert.ok(row.password_hash.startsWith('$argon2id$'));
        assert.ok(await argon2.verify(row.password_hash, input.temporaryPassword));
        const serialized = JSON.stringify(created);
        assert.ok(!serialized.includes(input.temporaryPassword));
        assert.ok(!serialized.includes('password_hash'));
        assert.ok(!serialized.includes(row.email));
        const login = new Browser(baseUrl);
        await login.login(row.email, input.temporaryPassword);
        assert.equal((await login.session()).user.mustChangePassword, true);
        await login.assertAccess(403, 'PASSWORD_CHANGE_REQUIRED');
        await deny(login, payload(), 403, 'PASSWORD_CHANGE_REQUIRED');
        const page = await login.request('/access');
        assert.equal(page.headers.get('location'), '/change-password');
        const nextPassword = `Cambio-${randomBytes(18).toString('hex')}!aA`;
        const changed = await login.request('/api/auth/change-password', {
          method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
          body: JSON.stringify({ currentPassword: input.temporaryPassword, newPassword: nextPassword, confirmPassword: nextPassword }),
        });
        assert.equal(changed.status, 200);
        await login.assertAccess(401, 'UNAUTHENTICATED');
        await login.login(row.email, nextPassword);
        await login.assertAccess(200);
        // Su rol SECRETARY tampoco adquiere permiso de provisión tras cambiar clave.
        await deny(login, payload(), 403, 'FORBIDDEN');
      });

      await t.test('delegado queda vinculado antes de afiliación; otros roles mantienen ámbito de liga', async () => {
        const input = payload({ roles: ['CLUB_DELEGATE', 'DATA_ENTRY'], club: { kind: 'new', name: 'Club previo a afiliación' } });
        const response = await post(admin.browser, input);
        assert.equal(response.status, 201);
        const created = await response.json();
        const grants = (await db.query(`SELECT r.code,ur.league_id,ur.club_id FROM sports_management.user_roles ur
          JOIN sports_management.roles r ON r.id=ur.role_id WHERE ur.user_id=$1`, [created.id])).rows;
        assert.equal(grants.length, 2);
        assert.equal(grants.find((r) => r.code === 'CLUB_DELEGATE').club_id, created.clubId);
        assert.equal(grants.find((r) => r.code === 'DATA_ENTRY').club_id, null);
        assert.ok(grants.every((r) => r.league_id === leagueA));
        assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.club_affiliations WHERE club_id=$1', [created.clubId])).rows[0].n, 0);
        const audits = (await db.query(`SELECT * FROM sports_management.audit_logs
          WHERE entity_id=$1::uuid OR (table_name='user_roles' AND new_data->>'user_id'=$1::text)`, [created.id])).rows;
        assert.equal(audits.length, 3, 'Un evento de alta y uno por rol, sin duplicar triggers.');
        assert.ok(audits.every((event) => event.user_id === admin.id));
        const json = JSON.stringify(audits);
        for (const forbidden of [input.email, input.temporaryPassword, '$argon2', 'password_hash', 'encrypted_mfa_secret'])
          assert.ok(!json.includes(forbidden));
        assert.equal((await post(admin.browser, payload({ roles: ['CLUB_DELEGATE'], club: { kind: 'existing', id: clubs[0] } }))).status, 201);
      });

      await t.test('reutiliza una persona sin cuenta y rechaza otra cuenta para esa identidad', async () => {
        const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Existente','Sintética') RETURNING id")).rows[0].id;
        const input = payload({ person: { id: person } });
        const count = (await totals()).people;
        const response = await post(admin.browser, input);
        assert.equal(response.status, 201);
        assert.equal((await response.json()).personId, person);
        assert.equal((await totals()).people, count);
        await deny(admin.browser, payload({ person: { id: person }, roles: ['CLUB_DELEGATE'], club: { kind: 'new', name: 'No debe persistir' } }), 409, 'PERSON_UNAVAILABLE');
        await deny(admin.browser, payload({ person: { id: randomUUID() } }), 409, 'PERSON_UNAVAILABLE');
      });

      await t.test('los duplicados y dos altas concurrentes se resuelven sin residuos', async () => {
        const input = payload({ roles: ['CLUB_DELEGATE'], club: { kind: 'new', name: 'Club concurrente sintético' } });
        const before = await totals();
        const responses = await Promise.all([post(admin.browser, input), post(admin.browser, input)]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
        const rejected = responses.find((r) => r.status === 409);
        assert.equal((await rejected.json()).code, 'DUPLICATE_ACCOUNT');
        const after = await totals();
        assert.equal(after.users - before.users, 1);
        assert.equal(after.people - before.people, 1);
        assert.equal(after.clubs - before.clubs, 1);
        assert.equal(after.roles - before.roles, 1);
        await deny(admin.browser, payload({ email: input.email.toUpperCase() }), 409, 'DUPLICATE_ACCOUNT');
        await deny(admin.browser, payload({ username: input.username.toUpperCase() }), 409, 'DUPLICATE_ACCOUNT');
      });

      await t.test('SUPERADMIN global se crea solo por administrador y permisos se revalidan', async () => {
        const input = payload({ roles: ['SUPERADMIN'], leagueId: undefined });
        const response = await post(admin.browser, input);
        assert.equal(response.status, 201);
        const created = await response.json();
        const grant = (await db.query('SELECT league_id,club_id FROM sports_management.user_roles WHERE user_id=$1', [created.id])).rows[0];
        assert.deepEqual(grant, { league_id: null, club_id: null });
        await db.query('BEGIN');
        await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.reason','Revocación sintética',true)", [admin.id]);
        await db.query("UPDATE sports_management.user_roles SET ends_at=clock_timestamp() WHERE user_id=$1", [admin.id]);
        await db.query('COMMIT');
        await deny(admin.browser, payload(), 403, 'FORBIDDEN');
        // Recuperar el rol para el caso de rollback siguiente, solo en la base temporal.
        await db.query('BEGIN');
        await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.reason','Restauración sintética',true)", [admin.id]);
        await db.query('UPDATE sports_management.user_roles SET ends_at=NULL WHERE user_id=$1', [admin.id]);
        await db.query('COMMIT');
      });

      await t.test('rol futuro, liga inactiva y club suspendido no habilitan altas', async () => {
        const future = await fixture('futuro', 'SUPERADMIN', null);
        await db.query('BEGIN');
        await db.query("SELECT set_config('app.user_id',$1,true),set_config('app.reason','Vigencia sintética',true)", [admin.id]);
        await db.query("UPDATE sports_management.user_roles SET starts_at=clock_timestamp()+interval '1 day' WHERE user_id=$1", [future.id]);
        await db.query('COMMIT');
        await deny(future.browser, payload(), 403, 'FORBIDDEN');
        await db.query('UPDATE sports_management.leagues SET is_active=false WHERE id=$1', [leagueB]);
        await deny(admin.browser, payload({ leagueId: leagueB }), 400, 'INVALID_CONTEXT');
        await db.query("UPDATE sports_management.clubs SET status='SUSPENDED' WHERE id=$1", [clubs[0]]);
        try {
          await deny(admin.browser, payload({ roles: ['CLUB_DELEGATE'], club: { kind: 'existing', id: clubs[0] } }), 400, 'INVALID_CONTEXT');
        } finally {
          await db.query("UPDATE sports_management.clubs SET status='ACTIVE' WHERE id=$1", [clubs[0]]);
        }
      });

      await t.test('un fallo de auditoría revierte persona, cuenta, club y roles', async () => {
        await db.query(`CREATE FUNCTION sports_management.fail_account_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.table_name='user_roles' AND NEW.reason='PDGLD-34: alta autorizada de cuenta y contexto inicial'
            THEN RAISE EXCEPTION 'Fallo sintético'; END IF; RETURN NEW; END $$`);
        await db.query('CREATE TRIGGER fail_account_audit_test BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION sports_management.fail_account_audit_test()');
        try {
          await deny(admin.browser, payload({ roles: ['CLUB_DELEGATE'], club: { kind: 'new', name: 'Rollback sintético' } }), 503, 'SERVICE_UNAVAILABLE');
        } finally {
          await db.query('DROP TRIGGER fail_account_audit_test ON sports_management.audit_logs');
          await db.query('DROP FUNCTION sports_management.fail_account_audit_test()');
        }
      });
    });
  } finally { await db.end(); }
}

