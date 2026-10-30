import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { createAuthFixtures, fixturePassword, paddedPassword } from './auth-fixtures.mjs';

export class Browser {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.receivedCookies = [];
  }

  async request(path, init = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) {
      headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    }
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      this.receivedCookies.push(cookie);
      const [pair] = cookie.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value || /max-age=0\b/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  async csrf() {
    const response = await this.request('/api/auth/csrf');
    assert.equal(response.status, 200, 'El endpoint CSRF debe responder.');
    const body = await response.json();
    assert.ok(typeof body.csrfToken === 'string' && body.csrfToken.length > 20, 'Falta token CSRF.');
    return body.csrfToken;
  }

  async login(email, password, callbackUrl = '/access') {
    const csrfToken = await this.csrf();
    const body = new URLSearchParams({ csrfToken, callbackUrl, json: 'true' });
    if (email !== undefined) body.set('email', email);
    if (password !== undefined) body.set('password', password);
    const response = await this.request('/api/auth/callback/credentials', {
      method: 'POST', body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.ok([200, 401].includes(response.status), 'Credentials debe responder sin error de servidor.');
    const result = await response.json();
    assert.ok(typeof result.url === 'string', 'Credentials debe devolver la URL del resultado.');
    return new URL(result.url, this.baseUrl);
  }

  async session() {
    const response = await this.request('/api/auth/session');
    assert.equal(response.status, 200, 'La consulta de sesión debe responder.');
    const body = await response.json();
    const serialized = JSON.stringify(body);
    for (const forbidden of [fixturePassword, paddedPassword, '$argon2', 'password_hash',
      'userVersion', '"sid"', 'token_hash', 'encrypted_mfa_secret', 'synthetic-mfa-value', 'csrfToken']) {
      assert.ok(!serialized.includes(forbidden), 'La sesión pública contiene datos internos.');
    }
    return body;
  }

  async updateSession(data) {
    const csrfToken = await this.csrf();
    const response = await this.request('/api/auth/session', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csrfToken, data }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  async assertAccess(status, error) {
    const response = await this.request('/api/access');
    assert.equal(response.status, status, 'Estado de autorización inesperado.');
    assert.match(response.headers.get('cache-control') ?? '', /no-store/, 'No compartir caché de identidad.');
    const body = await response.json();
    if (error) assert.equal(body.error, error);
    return body;
  }
}

function assertPublicIdentity(session, id, mustChangePassword) {
  assert.deepEqual(Object.keys(session).sort(), ['expires', 'user']);
  assert.ok(Number.isFinite(Date.parse(session.expires)), 'La sesión debe expresar su expiración.');
  assert.deepEqual(Object.keys(session.user).sort(), ['id', 'mustChangePassword']);
  assert.equal(session.user.id, id);
  assert.equal(session.user.mustChangePassword, mustChangePassword);
  assert.match(session.user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

/** Ejecutada por scripts/test-auth.mjs para controlar también un reinicio real. */
export async function runAuthIntegrationSuite({ databaseUrl, baseUrl, restartServer }) {
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Solo PostgreSQL loopback.');
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/, 'Se requiere una base temporal propia.');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const fixtures = await createAuthFixtures(client);
    await test('PDGLD-48: autenticación HTTP con PostgreSQL temporal real', { timeout: 240_000 }, async (t) => {
      await t.test('sin sesión se deniega acceso en el servidor', async () => {
        await new Browser(baseUrl).assertAccess(401, 'UNAUTHENTICATED');
        const login = await new Browser(baseUrl).request('/login');
        assert.equal(login.status, 200, 'La pantalla de acceso debe compilar y responder.');
        assert.match(await login.text(), /Usuario o correo electrónico/);
      });

      await t.test('correo sin distinguir mayúsculas autentica y expone solo UUID/estado', async () => {
        const browser = new Browser(baseUrl);
        const result = await browser.login(`  ${fixtures.operational.email.toUpperCase()}  `, fixturePassword);
        assert.equal(result.searchParams.has('error'), false, 'Las credenciales válidas deben autenticar.');
        assertPublicIdentity(await browser.session(), fixtures.operational.id, false);
        const access = await browser.assertAccess(200);
        assert.deepEqual(Object.keys(access), ['user']);
        assert.deepEqual(Object.keys(access.user).sort(), ['id', 'mustChangePassword']);
        const cookies = browser.receivedCookies.filter((cookie) => /^next-auth\.session-token(?:\.\d+)?=/.test(cookie));
        assert.ok(cookies.length > 0, 'NextAuth debe emitir la cookie de sesión.');
        for (const cookie of cookies) {
          assert.match(cookie, /;\s*HttpOnly(?:;|$)/i);
          assert.match(cookie, /;\s*SameSite=Lax(?:;|$)/i);
          assert.match(cookie, /;\s*Path=\/(?:;|$)/i);
        }
      });

      await t.test('usuario y correo resuelven la misma cuenta sin distinguir mayúsculas ni interpretar comodines', async () => {
        const browser = new Browser(baseUrl);
        assert.equal((await browser.login(' PDGLD48_OPERATIONAL ', fixturePassword)).searchParams.has('error'), false);
        assertPublicIdentity(await browser.session(), fixtures.operational.id, false);
        const underscore = new Browser(baseUrl);
        assert.equal((await underscore.login('pdgld48_underscore', fixturePassword)).searchParams.has('error'), false);
        assertPublicIdentity(await underscore.session(), fixtures.underscore.id, false);
        for (const username of ['pdgld48_operativ_', 'pdgld48_%']) {
          const denied = new Browser(baseUrl);
          assert.equal((await denied.login(username, fixturePassword)).searchParams.get('error'), 'CredentialsSignin');
          assert.equal((await denied.session()).user, undefined);
        }
      });

      await t.test('las contraseñas conservan espacios significativos', async () => {
        const valid = new Browser(baseUrl);
        assert.equal((await valid.login(fixtures.padded.email, paddedPassword)).searchParams.has('error'), false);
        await valid.assertAccess(200);
        const invalid = new Browser(baseUrl);
        assert.equal((await invalid.login(fixtures.padded.email, paddedPassword.trim())).searchParams.get('error'), 'CredentialsSignin');
        await invalid.assertAccess(401, 'UNAUTHENTICATED');
      });

      await t.test('un correo con guion bajo se autentica por coincidencia literal', async () => {
        const browser = new Browser(baseUrl);
        const result = await browser.login(fixtures.underscore.email, fixturePassword);
        assert.equal(result.searchParams.has('error'), false);
        assertPublicIdentity(await browser.session(), fixtures.underscore.id, false);
        await browser.assertAccess(200);
      });

      await t.test('errores genéricos para cuenta ausente, deshabilitada o hash inválido', async () => {
        const attempts = [
          [fixtures.operational.email, 'incorrecta'], ['ausente@example.test', fixturePassword],
          ['operativ_@example.test', fixturePassword], ['%@example.test', fixturePassword],
          [fixtures.inactive.email, fixturePassword],
          [fixtures.unknownHash.email, fixturePassword], [fixtures.corruptHash.email, fixturePassword],
          [undefined, fixturePassword], [fixtures.operational.email, undefined],
          ['correo-invalido', fixturePassword], [fixtures.operational.email, ''],
          [fixtures.operational.email, 'x'.repeat(1025)], ['x'.repeat(255) + '@example.test', fixturePassword],
        ];
        for (const [email, password] of attempts) {
          const browser = new Browser(baseUrl);
          const result = await browser.login(email, password);
          assert.equal(result.searchParams.get('error'), 'CredentialsSignin', 'No revelar la causa de rechazo.');
          assert.equal((await browser.session()).user, undefined, 'El rechazo no debe crear una identidad.');
          await browser.assertAccess(401, 'UNAUTHENTICATED');
        }
      });

      await t.test('el bloqueo vigente devuelve solo política y tiempo restante, sin crear sesión', async () => {
        const browser = new Browser(baseUrl);
        for (const identifier of [fixtures.locked.email, 'pdgld48_locked', 'ausente@example.test', 'usuario_ausente']) {
          const denied = await browser.login(identifier, 'incorrecta');
          assert.equal(denied.searchParams.get('error'), 'CredentialsSignin', 'Una contraseña incorrecta no revela existencia ni bloqueo.');
          assert.equal((await browser.session()).user, undefined);
        }
        const result = await browser.login(fixtures.locked.email, fixturePassword);
        assert.match(result.searchParams.get('error'), /^LOGIN_LOCKED_5_(?:[1-9]|1[0-5])$/);
        assert.equal((await browser.session()).user, undefined);
        await browser.assertAccess(401, 'UNAUTHENTICATED');
      });

      await t.test('CSRF ausente impide autenticar incluso con credenciales correctas', async () => {
        const browser = new Browser(baseUrl);
        const response = await browser.request('/api/auth/callback/credentials', {
          method: 'POST',
          body: new URLSearchParams({ email: fixtures.operational.email, password: fixturePassword, json: 'true' }),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
        assert.ok(response.status < 500, 'El rechazo CSRF debe ser controlado.');
        await browser.assertAccess(401, 'UNAUTHENTICATED');
      });

      await t.test('cambio obligatorio restringe servidor y update() no puede promover la sesión', async () => {
        const browser = new Browser(baseUrl);
        await browser.login(fixtures.temporary.email, fixturePassword);
        assertPublicIdentity(await browser.session(), fixtures.temporary.id, true);
        await browser.assertAccess(403, 'PASSWORD_CHANGE_REQUIRED');
        const csrfToken = await browser.csrf();
        const update = await browser.request('/api/auth/session', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ csrfToken, data: { mustChangePassword: false,
            user: { id: fixtures.operational.id, mustChangePassword: false }, userVersion: 999 } }),
        });
        assert.equal(update.status, 200, 'La actualización de sesión debe responder.');
        assertPublicIdentity(await browser.session(), fixtures.temporary.id, true);
        await browser.assertAccess(403, 'PASSWORD_CHANGE_REQUIRED');
        await client.query('UPDATE sports_management.users SET must_change_password = false WHERE id = $1', [fixtures.temporary.id]);
        await browser.assertAccess(403, 'PASSWORD_CHANGE_REQUIRED');
        const fresh = new Browser(baseUrl);
        await fresh.login(fixtures.temporary.email, fixturePassword);
        await fresh.assertAccess(200);
      });

      await t.test('deshabilitar, bloquear o cambiar versión revoca cookies existentes', async () => {
        for (const mutation of ['is_active = false', "locked_until = now() + interval '15 minutes'", 'version = version + 1']) {
          await client.query('UPDATE sports_management.users SET is_active = true, locked_until = NULL WHERE id = $1', [fixtures.operational.id]);
          const browser = new Browser(baseUrl);
          await browser.login(fixtures.operational.email, fixturePassword);
          await browser.assertAccess(200);
          const oldCookies = new Map(browser.cookies);
          // mutation procede de constantes del test, nunca de entrada externa.
          await client.query(`UPDATE sports_management.users SET ${mutation} WHERE id = $1`, [fixtures.operational.id]);
          await browser.assertAccess(401, 'UNAUTHENTICATED');
          assert.equal((await browser.session()).user, undefined);
          browser.cookies = oldCookies;
          await browser.assertAccess(401, 'UNAUTHENTICATED');
        }
      });

      await t.test('cinco fallos simultáneos se conservan y bloquean sin prolongar el bloqueo', async () => {
        const account = fixtures.concurrent;
        const results = await Promise.all(Array.from({ length: 5 }, (_, index) =>
          new Browser(baseUrl).login(index % 2 ? 'pdgld48_concurrent' : account.email, 'incorrecta')));
        assert.equal(results.filter(result => result.searchParams.get('error') === 'CredentialsSignin').length, 5);
        const state = async () => (await client.query(
          'SELECT failed_login_attempts, locked_until FROM sports_management.users WHERE id = $1',
          [account.id],
        )).rows[0];
        const locked = await state();
        assert.equal(locked.failed_login_attempts, 5);
        assert.ok(locked.locked_until > new Date());
        assert.ok(locked.locked_until <= new Date(Date.now() + 15 * 60_000));
        const audit = async () => (await client.query(
          'SELECT action FROM sports_management.authentication_events WHERE user_id = $1', [account.id],
        )).rows.map((row) => row.action);
        assert.equal((await audit()).filter((action) => action === 'LOGIN_FAILED').length, 5);
        assert.equal((await audit()).filter((action) => action === 'BLOCK').length, 1);
        const browser = new Browser(baseUrl);
        assert.match((await browser.login(account.email, fixturePassword)).searchParams.get('error'), /^LOGIN_LOCKED_5_(?:[1-9]|1[0-5])$/);
        assert.deepEqual(await state(), locked, 'Un intento durante el bloqueo no altera su vencimiento.');
        assert.equal((await audit()).filter((action) => action === 'BLOCK').length, 1);
        assert.equal((await audit()).filter((action) => action === 'LOGIN_FAILED').length, 6);

        await client.query("UPDATE sports_management.users SET locked_until = now() - interval '1 second' WHERE id = $1", [account.id]);
        assert.equal((await browser.login(account.email, 'incorrecta')).searchParams.get('error'), 'CredentialsSignin');
        assert.deepEqual(await state(), { failed_login_attempts: 1, locked_until: null });
        assert.equal((await browser.login(account.email, fixturePassword)).searchParams.has('error'), false);
        assert.deepEqual(await state(), { failed_login_attempts: 0, locked_until: null });
        await browser.assertAccess(200);
      });

      await t.test('PDGLD-49: cuentas inexistentes auditan sin identidad ni crear usuarios', async () => {
        const usersBefore = (await client.query('SELECT count(*)::int AS total FROM sports_management.users')).rows[0].total;
        const before = (await client.query("SELECT count(*)::int AS total FROM sports_management.authentication_events WHERE user_id IS NULL AND action = 'LOGIN_FAILED'")).rows[0].total;
        const browser = new Browser(baseUrl);
        assert.equal((await browser.login('sin-cuenta-pdgld49@example.test', fixturePassword)).searchParams.get('error'), 'CredentialsSignin');
        await browser.assertAccess(401, 'UNAUTHENTICATED');
        const after = (await client.query("SELECT count(*)::int AS total FROM sports_management.authentication_events WHERE user_id IS NULL AND action = 'LOGIN_FAILED'")).rows[0].total;
        assert.equal(after, before + 1);
        assert.equal((await client.query('SELECT count(*)::int AS total FROM sports_management.users')).rows[0].total, usersBefore);
      });

      await t.test('PDGLD-49: rollback de intentos y bloqueo si falla LOGIN_FAILED o BLOCK', async () => {
        const account = fixtures.concurrent;
        for (const action of ['LOGIN_FAILED', 'BLOCK']) {
          await client.query('UPDATE sports_management.users SET failed_login_attempts = $2, locked_until = NULL WHERE id = $1',
            [account.id, action === 'BLOCK' ? 4 : 0]);
          const state = async () => (await client.query('SELECT failed_login_attempts, locked_until FROM sports_management.users WHERE id = $1', [account.id])).rows[0];
          const events = async () => (await client.query('SELECT id FROM sports_management.authentication_events WHERE user_id = $1 ORDER BY id', [account.id])).rows;
          const before = await state();
          const auditBefore = await events();
          // Fallo de almacenamiento solo en la base desechable; triggers intactos.
          await client.query(`ALTER TABLE sports_management.authentication_events ADD CONSTRAINT pdgld49_reject_event CHECK (action <> '${action}') NOT VALID`);
          try {
            assert.equal((await new Browser(baseUrl).login(account.email, 'incorrecta')).searchParams.get('error'), 'CredentialsSignin');
            assert.deepEqual(await state(), before);
            assert.deepEqual(await events(), auditBefore, 'BLOCK fallido también revierte LOGIN_FAILED.');
          } finally {
            await client.query('ALTER TABLE sports_management.authentication_events DROP CONSTRAINT pdgld49_reject_event');
          }
        }
        await client.query('UPDATE sports_management.users SET failed_login_attempts = 0 WHERE id = $1', [account.id]);
      });

      await t.test('PDGLD-49: política de tres intentos/dos minutos aplicada tras reinicio', async () => {
        const account = fixtures.concurrent;
        try {
          await restartServer('30', { maxFailedAttempts: '3', lockoutMinutes: '2' });
          const state = async () => (await client.query('SELECT failed_login_attempts, locked_until FROM sports_management.users WHERE id = $1', [account.id])).rows[0];
          for (let i = 1; i <= 2; i++) {
            await new Browser(baseUrl).login(account.email, 'incorrecta');
            assert.deepEqual(await state(), { failed_login_attempts: i, locked_until: null });
          }
          const start = Date.now();
          const blocked = await new Browser(baseUrl).login(account.email, 'incorrecta');
          assert.equal(blocked.searchParams.get('error'), 'CredentialsSignin');
          const verified = await new Browser(baseUrl).login(account.email, fixturePassword);
          assert.equal(verified.searchParams.get('error'), 'LOGIN_LOCKED_3_2');
          const locked = await state();
          assert.equal(locked.failed_login_attempts, 3);
          assert.ok(locked.locked_until.getTime() >= start + 120_000);
          assert.ok(locked.locked_until.getTime() <= Date.now() + 120_000);
        } finally {
          await restartServer();
          await client.query('UPDATE sports_management.users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [account.id]);
        }
      });

      await t.test('cambiar la contraseña incrementa la versión, revoca cookies y permite un login nuevo', async () => {
        const account = fixtures.passwordChange;
        const browser = new Browser(baseUrl);
        const otherSession = new Browser(baseUrl);
        await browser.login(account.email, fixturePassword);
        await otherSession.login(account.email, fixturePassword);
        await browser.assertAccess(403, 'PASSWORD_CHANGE_REQUIRED');
        const oldCookies = new Map(browser.cookies);
        const state = async () => (await client.query(
          'SELECT password_hash, must_change_password, version, failed_login_attempts, locked_until FROM sports_management.users WHERE id = $1',
          [account.id],
        )).rows[0];
        const assertUnchangedState = async (expected) => {
          const actual = await state();
          assert.ok(actual.password_hash === expected.password_hash, 'El rechazo debe conservar el hash.');
          assert.deepEqual({ ...actual, password_hash: undefined }, { ...expected, password_hash: undefined },
            'El rechazo debe conservar flag, versión y contadores.');
        };
        const before = await state();
        const newPassword = 'Nueva-Local-49!segura';
        const change = (currentPassword) => browser.request('/api/auth/change-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: baseUrl },
          body: JSON.stringify({ currentPassword, newPassword, confirmPassword: newPassword }),
        });
        const changes = async () => (await client.query("SELECT id FROM sports_management.authentication_events WHERE user_id = $1 AND action = 'PASSWORD_CHANGED'", [account.id])).rows;
        const auditBefore = await changes();
        const payload = JSON.stringify({ currentPassword: fixturePassword, newPassword, confirmPassword: newPassword });
        const rejections = [
          [{ 'content-type': 'application/json', origin: 'https://ajeno.example.test',
            'x-forwarded-host': 'ajeno.example.test', 'x-forwarded-proto': 'https' }, 403],
          [{ 'content-type': 'application/json' }, 403],
          [{ 'content-type': 'application/json', origin: 'null' }, 403],
          [{ 'content-type': 'application/json', origin: baseUrl, 'sec-fetch-site': 'cross-site' }, 403],
          [{ 'content-type': 'text/plain', origin: baseUrl }, 400],
          [{ 'content-type': 'application/x-www-form-urlencoded', origin: baseUrl }, 400],
          [{ origin: baseUrl }, 400],
        ];
        for (const [headers, status] of rejections) {
          const response = await browser.request('/api/auth/change-password', { method: 'POST', headers, body: payload });
          assert.equal(response.status, status);
          assert.equal((await response.json()).code, status === 403 ? 'INVALID_ORIGIN' : 'INVALID_PAYLOAD');
          await assertUnchangedState(before);
          assert.deepEqual(await changes(), auditBefore);
        }
        assert.equal((await change('incorrecta')).status, 400);
        await assertUnchangedState(before);
        assert.deepEqual(await changes(), auditBefore);
        await client.query('UPDATE sports_management.users SET failed_login_attempts = 2, locked_until = now() - interval \'1 second\' WHERE id = $1', [account.id]);
        const auditFailureState = await state();
        await client.query("ALTER TABLE sports_management.authentication_events ADD CONSTRAINT pdgld49_reject_event CHECK (action <> 'PASSWORD_CHANGED') NOT VALID");
        try {
          assert.equal((await change(fixturePassword)).status, 500);
          await assertUnchangedState(auditFailureState);
          assert.deepEqual(await changes(), auditBefore);
          await browser.assertAccess(403, 'PASSWORD_CHANGE_REQUIRED');
        } finally {
          await client.query('ALTER TABLE sports_management.authentication_events DROP CONSTRAINT pdgld49_reject_event');
        }
        assert.equal((await change(fixturePassword)).status, 200);
        const after = await state();
        assert.equal(after.version, before.version + 1);
        assert.equal(after.must_change_password, false);
        assert.ok(after.password_hash !== before.password_hash, 'El cambio confirmado debe sustituir el hash.');
        assert.equal(after.failed_login_attempts, 0);
        assert.equal(after.locked_until, null);
        assert.equal((await changes()).length, auditBefore.length + 1);
        await browser.assertAccess(401, 'UNAUTHENTICATED');
        await otherSession.assertAccess(401, 'UNAUTHENTICATED');
        browser.cookies = oldCookies;
        await browser.assertAccess(401, 'UNAUTHENTICATED');

        // Mismo cierre que utiliza signOut() de NextAuth 4 en el formulario.
        const csrfToken = await browser.csrf();
        const logout = await browser.request('/api/auth/signout', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ csrfToken, callbackUrl: `${baseUrl}/login`, json: 'true' }),
        });
        assert.equal(logout.status, 200);
        assert.equal(new URL((await logout.json()).url).pathname, '/login');
        assert.equal([...browser.cookies.keys()].some((key) => key.startsWith('next-auth.session-token')), false);
        assert.equal((await browser.request('/login')).status, 200);
        assert.equal((await browser.login(account.email, fixturePassword)).searchParams.get('error'), 'CredentialsSignin');
        assert.equal((await browser.login(account.email, newPassword)).searchParams.has('error'), false);
        assertPublicIdentity(await browser.session(), account.id, false);
        await browser.assertAccess(200);
      });

      await t.test('dos cambios simultáneos no aceptan dos veces la misma contraseña anterior', async () => {
        const account = fixtures.passwordChange;
        const currentPassword = 'Nueva-Local-49!segura';
        const newPasswords = ['Segunda-Local-49!segura', 'Tercera-Local-49!segura'];
        const browsers = [new Browser(baseUrl), new Browser(baseUrl)];
        for (const browser of browsers) {
          assert.equal((await browser.login(account.email, currentPassword)).searchParams.has('error'), false);
        }
        const before = (await client.query('SELECT version FROM sports_management.users WHERE id = $1', [account.id])).rows[0];
        const responses = await Promise.all(browsers.map((browser, index) =>
          browser.request('/api/auth/change-password', {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: baseUrl },
            body: JSON.stringify({ currentPassword, newPassword: newPasswords[index], confirmPassword: newPasswords[index] }),
          })));
        const winner = responses.findIndex((response) => response.status === 200);
        assert.ok(winner >= 0, 'Un cambio debe completar.');
        assert.equal(responses.filter((response) => response.status === 200).length, 1);
        assert.ok([400, 401].includes(responses[1 - winner].status), 'Rechazar la contraseña o sesión anterior.');
        const after = (await client.query('SELECT version FROM sports_management.users WHERE id = $1', [account.id])).rows[0];
        assert.equal(after.version, before.version + 1, 'Solo una transacción debe cambiar las credenciales.');
        const audited = (await client.query("SELECT count(*)::int AS total FROM sports_management.authentication_events WHERE user_id = $1 AND action = 'PASSWORD_CHANGED'", [account.id])).rows[0];
        assert.equal(audited.total, 2, 'Un evento del cambio anterior y uno del cambio concurrente ganador.');
        for (const browser of browsers) await browser.assertAccess(401, 'UNAUTHENTICATED');
        const fresh = new Browser(baseUrl);
        assert.equal((await fresh.login(account.email, newPasswords[1 - winner])).searchParams.get('error'), 'CredentialsSignin');
        assert.equal((await fresh.login(account.email, newPasswords[winner])).searchParams.has('error'), false);
        await fresh.assertAccess(200);
      });

      await t.test('un cambio obligatorio nuevo restringe inmediatamente una sesión anterior', async () => {
        const browser = new Browser(baseUrl);
        await browser.login(fixtures.padded.email, paddedPassword);
        await browser.assertAccess(200);
        await client.query('UPDATE sports_management.users SET must_change_password = true WHERE id = $1', [fixtures.padded.id]);
        await browser.assertAccess(403, 'PASSWORD_CHANGE_REQUIRED');
        await client.query('UPDATE sports_management.users SET must_change_password = false WHERE id = $1', [fixtures.padded.id]);
      });

      await t.test('callbackUrl externa no redirige fuera del origen', async () => {
        const browser = new Browser(baseUrl);
        const result = await browser.login(fixtures.padded.email, paddedPassword, 'https://external.example.test/collect');
        assert.equal(result.origin, new URL(baseUrl).origin, 'La redirección debe conservar el origen.');
      });

      await t.test('la cookie JWT continúa funcionando después de reiniciar el servidor', async () => {
        const browser = new Browser(baseUrl);
        await browser.login(fixtures.padded.email, paddedPassword);
        await browser.assertAccess(200);
        await restartServer();
        assertPublicIdentity(await browser.session(), fixtures.padded.id, false);
        await browser.assertAccess(200);
      });

      const latestIdleSession = async () => (await client.query(
        'SELECT id, token_hash, created_at, last_activity_at, expires_at, revoked_at FROM sports_management.sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [fixtures.idle.id],
      )).rows[0];

      await t.test('consultas automáticas no prolongan la inactividad ni reviven una sesión vencida', async () => {
        const browser = new Browser(baseUrl);
        await browser.login(fixtures.idle.email, fixturePassword);
        const oldCookies = new Map(browser.cookies);
        const record = await latestIdleSession();
        assert.match(record.token_hash, /^[0-9a-f]{64}$/, 'Solo se guarda el hash del secreto de sesión.');
        await client.query(`UPDATE sports_management.sessions
          SET created_at = now() - interval '2 hours', last_activity_at = now() - interval '29 minutes',
              expires_at = now() + interval '1 minute' WHERE id = $1`, [record.id]);
        const before = await latestIdleSession();
        for (let i = 0; i < 3; i++) {
          const session = await browser.session();
          assertPublicIdentity(session, fixtures.idle.id, false);
          assert.equal(Date.parse(session.expires), before.expires_at.getTime());
          await browser.assertAccess(200);
        }
        await browser.updateSession({ mustChangePassword: false, expires: '2099-01-01', lastActivityAt: Date.now() });
        assert.deepEqual(await latestIdleSession(), before, 'GET y update sin intención de actividad no cambian el plazo.');

        await client.query(`UPDATE sports_management.sessions
          SET last_activity_at = now() - interval '31 minutes', expires_at = now() - interval '1 minute'
          WHERE id = $1`, [record.id]);
        const expired = await latestIdleSession();
        await browser.assertAccess(401, 'UNAUTHENTICATED');
        assert.equal((await browser.session()).user, undefined);
        browser.cookies = new Map(oldCookies);
        assert.equal((await browser.updateSession({ action: 'activity', expires: '2099-01-01' })).user, undefined);
        const rejected = await latestIdleSession();
        assert.ok(rejected.revoked_at instanceof Date, 'Se persiste la invalidación sin renovar actividad.');
        assert.deepEqual({ ...rejected, revoked_at: expired.revoked_at }, expired, 'Ni una cookie anterior ni un POST reviven la sesión.');
      });

      await t.test('actividad explícita renueva una sesión con más de 30 minutos de antigüedad', async () => {
        const browser = new Browser(baseUrl);
        await browser.login(fixtures.idle.email, fixturePassword);
        const record = await latestIdleSession();
        await client.query(`UPDATE sports_management.sessions
          SET created_at = now() - interval '2 hours', last_activity_at = now() - interval '25 minutes',
              expires_at = now() + interval '5 minutes' WHERE id = $1`, [record.id]);
        const before = await latestIdleSession();
        const session = await browser.updateSession({ action: 'activity', user: { id: fixtures.operational.id },
          userVersion: 999, lastActivityAt: '2099-01-01', expires: '2099-01-01' });
        assertPublicIdentity(session, fixtures.idle.id, false);
        const after = await latestIdleSession();
        assert.equal(after.id, before.id, 'Las renovaciones conservan la misma sesión persistente.');
        assert.equal(after.token_hash, before.token_hash);
        assert.equal(after.created_at.getTime(), before.created_at.getTime());
        assert.ok(after.last_activity_at > before.last_activity_at);
        assert.ok(after.expires_at > new Date(Date.now() + 29 * 60_000));
        assert.equal(after.expires_at.getTime() - after.last_activity_at.getTime(), 30 * 60_000);
        assert.equal(Date.parse(session.expires), after.expires_at.getTime());
        await browser.assertAccess(200);
        await browser.session();
        assert.deepEqual(await latestIdleSession(), after, 'La lectura posterior tampoco renueva actividad.');
      });

      await t.test('actividad sin CSRF no renueva el plazo de una sesión', async () => {
        const browser = new Browser(baseUrl);
        await browser.login(fixtures.idle.email, fixturePassword);
        const before = await latestIdleSession();
        await browser.request('/api/auth/session', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: { action: 'activity' } }),
        });
        assert.deepEqual(await latestIdleSession(), before);
      });

      await t.test('cerrar sesión revoca su cookie y conserva otra sesión del mismo usuario', async () => {
        const first = new Browser(baseUrl);
        const second = new Browser(baseUrl);
        await first.login(fixtures.idle.email, fixturePassword);
        const firstRecord = await latestIdleSession();
        const oldCookies = new Map(first.cookies);
        await second.login(fixtures.idle.email, fixturePassword);
        const secondRecord = await latestIdleSession();
        const csrfToken = await first.csrf();
        const response = await first.request('/api/auth/signout', {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ csrfToken, callbackUrl: `${baseUrl}/login`, json: 'true' }),
        });
        assert.equal(response.status, 200);
        const revoked = (await client.query('SELECT revoked_at FROM sports_management.sessions WHERE id = $1', [firstRecord.id])).rows[0];
        assert.ok(revoked.revoked_at instanceof Date);
        first.cookies = oldCookies;
        await first.assertAccess(401, 'UNAUTHENTICATED');
        await second.assertAccess(200);
        assert.equal((await latestIdleSession()).id, secondRecord.id);
        assert.equal((await latestIdleSession()).revoked_at, null);
      });

      await t.test('retirar la sesión persistente deniega cookies anteriores y conserva la identidad auditada', async () => {
        const browser = new Browser(baseUrl);
        await browser.login(fixtures.padded.email, paddedPassword);
        // LOGIN_OK conserva la identidad por FK en el historial inmutable.
        // No eliminar auditoría para simular una baja que el esquema prohíbe.
        await client.query('DELETE FROM sports_management.sessions WHERE user_id = $1', [fixtures.padded.id]);
        await assert.rejects(client.query('DELETE FROM sports_management.users WHERE id = $1', [fixtures.padded.id]),
          (error) => error.code === '23503');
        await browser.assertAccess(401, 'UNAUTHENTICATED');
        assert.equal((await browser.session()).user, undefined);
      });
    });
  } finally {
    await client.end();
  }
}
