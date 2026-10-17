import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { createAuthFixtures, fixturePassword, paddedPassword } from './auth-fixtures.mjs';

class Browser {
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
      'userVersion', 'encrypted_mfa_secret', 'synthetic-mfa-value', 'csrfToken']) {
      assert.ok(!serialized.includes(forbidden), 'La sesión pública contiene datos internos.');
    }
    return body;
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
        assert.match(await login.text(), /Correo electrónico/);
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

      await t.test('errores genéricos para cuenta ausente, deshabilitada, bloqueada o hash inválido', async () => {
        const attempts = [
          [fixtures.operational.email, 'incorrecta'], ['ausente@example.test', fixturePassword],
          ['operativ_@example.test', fixturePassword], ['%@example.test', fixturePassword],
          [fixtures.inactive.email, fixturePassword], [fixtures.locked.email, fixturePassword],
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
await t.test('cerrar sesión impide reutilizar su cookie y conserva otra sesión', async () => {
  const browser = new Browser(baseUrl);
  const otherBrowser = new Browser(baseUrl);

  await browser.login(fixtures.padded.email, paddedPassword);
  await otherBrowser.login(fixtures.padded.email, paddedPassword);

  await browser.assertAccess(200);
  await otherBrowser.assertAccess(200);

  const csrfToken = await browser.csrf();

  // Guardamos una copia para simular reutilizar la cookie anterior.
  const replayBrowser = new Browser(baseUrl);
  replayBrowser.cookies = new Map(browser.cookies);

  const response = await browser.request('/api/auth/signout', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      csrfToken,
      callbackUrl: '/login',
      json: 'true',
    }),
  });

  assert.equal(response.status, 200, 'El cierre debe responder correctamente.');

  await browser.assertAccess(401, 'UNAUTHENTICATED');
  await replayBrowser.assertAccess(401, 'UNAUTHENTICATED');
  assert.equal((await replayBrowser.session()).user, undefined);

  await otherBrowser.assertAccess(200);
});
await t.test('solo la actividad explícita renueva la sesión', async () => {
  const browser = new Browser(baseUrl);
  await browser.login(fixtures.padded.email, paddedPassword);

  const result = await client.query(
    `SELECT id
     FROM sports_management.sessions
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [fixtures.padded.id],
  );

  assert.equal(result.rows.length, 1);
  const sessionId = result.rows[0].id;

  // Simulamos un minuto sin actividad en esta sesión de prueba.
  const before = await client.query(
    `UPDATE sports_management.sessions
     SET last_activity_at = now() - interval '1 minute'
     WHERE id = $1
     RETURNING last_activity_at, expires_at`,
    [sessionId],
  );

  await browser.session();
  await browser.assertAccess(200);

  const afterRead = await client.query(
    `SELECT last_activity_at, expires_at
     FROM sports_management.sessions WHERE id = $1`,
    [sessionId],
  );

  assert.deepEqual(
    afterRead.rows[0],
    before.rows[0],
    'Consultar la sesión o el acceso no debe renovar la inactividad.',
  );

  const response = await browser.request('/api/session/activity', {
    method: 'POST',
    headers: {
      origin: new URL(baseUrl).origin,
      'x-session-activity': 'interaction',
    },
  });

  assert.equal(response.status, 200);

  const afterActivity = await client.query(
    `SELECT last_activity_at, expires_at
     FROM sports_management.sessions WHERE id = $1`,
    [sessionId],
  );

  assert.ok(
    afterActivity.rows[0].last_activity_at.getTime() >
      before.rows[0].last_activity_at.getTime(),
    'La actividad debe actualizar la última actividad.',
  );

  assert.ok(
    afterActivity.rows[0].expires_at.getTime() >
      before.rows[0].expires_at.getTime(),
    'La actividad debe extender la expiración.',
  );
});
await t.test('la inactividad vence la sesión e impide reactivarla', async () => {
  const browser = new Browser(baseUrl);
  await browser.login(fixtures.padded.email, paddedPassword);
  await browser.assertAccess(200);

  const result = await client.query(
    `SELECT id
     FROM sports_management.sessions
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [fixtures.padded.id],
  );

  assert.equal(result.rows.length, 1);
  const sessionId = result.rows[0].id;

  // La cookie sigue vigente; simulamos inactividad en el servidor.
  await client.query(
    `UPDATE sports_management.sessions
     SET last_activity_at = now() - interval '31 minutes'
     WHERE id = $1`,
    [sessionId],
  );

  // Intentar registrar actividad después del límite debe fallar.
  const response = await browser.request('/api/session/activity', {
    method: 'POST',
    headers: {
      origin: new URL(baseUrl).origin,
      'x-session-activity': 'interaction',
    },
  });

  assert.equal(response.status, 401);

  await browser.assertAccess(401, 'UNAUTHENTICATED');
  assert.equal((await browser.session()).user, undefined);

  const stored = await client.query(
    `SELECT revoked_at
     FROM sports_management.sessions
     WHERE id = $1`,
    [sessionId],
  );

  assert.ok(
    stored.rows[0].revoked_at,
    'La sesión vencida debe quedar revocada.',
  );
});
await t.test('un fallo al revocar conserva la cookie y permite reintentar', async () => {
  const browser = new Browser(baseUrl);
  await browser.login(fixtures.padded.email, paddedPassword);
  await browser.assertAccess(200);

  const csrfToken = await browser.csrf();
  const originalCookies = new Map(browser.cookies);

  const signOut = () => browser.request('/api/auth/signout', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      csrfToken,
      callbackUrl: '/login',
      json: 'true',
    }),
  });

  // Provocamos un fallo únicamente en la base temporal.
  await client.query(`
    CREATE FUNCTION sports_management.pdgld51_fail_revoke()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
        RAISE EXCEPTION 'PDGLD51_TEST_REVOKE_FAILURE';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);

  try {
    await client.query(`
      CREATE TRIGGER pdgld51_fail_revoke
      BEFORE UPDATE ON sports_management.sessions
      FOR EACH ROW
      EXECUTE FUNCTION sports_management.pdgld51_fail_revoke();
    `);

    const response = await signOut();

    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'SIGNOUT_FAILED');
    assert.deepEqual(
      browser.cookies,
      originalCookies,
      'Un cierre fallido debe conservar las cookies.',
    );
  } finally {
    await client.query(`
      DROP TRIGGER IF EXISTS pdgld51_fail_revoke
      ON sports_management.sessions;
    `);
    await client.query(`
      DROP FUNCTION sports_management.pdgld51_fail_revoke();
    `);
  }

  await browser.assertAccess(200);

  const retry = await signOut();
  assert.equal(retry.status, 200);
  await browser.assertAccess(401, 'UNAUTHENTICATED');
});
await t.test('audita el acceso y no duplica el cierre de sesión', async () => {
  const countEvents = async () => {
    const result = await client.query(
      `SELECT
         count(*) FILTER (WHERE action = 'LOGIN_OK')::int AS logins,
         count(*) FILTER (WHERE action = 'LOGOUT')::int AS logouts
       FROM sports_management.authentication_events
       WHERE user_id = $1`,
      [fixtures.padded.id],
    );
    return result.rows[0];
  };

  const before = await countEvents();

  const browser = new Browser(baseUrl);
  await browser.login(fixtures.padded.email, paddedPassword);
  await browser.assertAccess(200);

  const afterLogin = await countEvents();
  assert.equal(afterLogin.logins, before.logins + 1);

  const csrfToken = await browser.csrf();
  const replayBrowser = new Browser(baseUrl);
  replayBrowser.cookies = new Map(browser.cookies);

  const signOut = (target) => target.request('/api/auth/signout', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      csrfToken,
      callbackUrl: '/login',
      json: 'true',
    }),
  });

  assert.equal((await signOut(browser)).status, 200);

  const afterLogout = await countEvents();
  assert.equal(afterLogout.logouts, before.logouts + 1);

  // Repetir el cierre con la cookie anterior no debe duplicar el evento.
  assert.equal((await signOut(replayBrowser)).status, 200);

  const afterReplay = await countEvents();
  assert.deepEqual(afterReplay, afterLogout);
  await replayBrowser.assertAccess(401, 'UNAUTHENTICATED');
});
   await t.test('desactivar la cuenta revoca la sesión sin exponer datos', async () => {
  const browser = new Browser(baseUrl);
  await browser.login(fixtures.padded.email, paddedPassword);
  await browser.assertAccess(200);

  await client.query(
    'UPDATE sports_management.users SET is_active = false WHERE id = $1',
    [fixtures.padded.id],
  );

  await browser.assertAccess(401, 'UNAUTHENTICATED');
  assert.equal((await browser.session()).user, undefined);
});
    });
  } finally {
    await client.end();
  }
}
