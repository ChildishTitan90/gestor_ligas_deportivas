import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import * as argon2 from 'argon2';
import { Browser } from './auth.test.mjs';

/** Integra los escenarios de PDGLD-51 sin sustituir las regresiones de develop. */
export async function runSessionLifecycleSuite({ databaseUrl, baseUrl, restartServer }) {
  const target = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const password = `Synthetic-${randomBytes(20).toString('hex')}!aA`;
  try {
    const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Sintético','Sesiones') RETURNING id")).rows[0].id;
    const email = `session-${randomUUID()}@example.test`;
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const user = (await db.query(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
      VALUES ($1,$2,$2,$3,false) RETURNING id`, [person, email, hash])).rows[0].id;
    const count = async () => (await db.query(`SELECT
      count(*) FILTER (WHERE action='LOGIN_OK')::int logins,
      count(*) FILTER (WHERE action='LOGOUT')::int logouts
      FROM sports_management.authentication_events WHERE user_id=$1`, [user])).rows[0];
    async function login() {
      const browser = new Browser(baseUrl);
      assert.ok(!(await browser.login(email, password)).searchParams.has('error'));
      return browser;
    }
    async function logout(browser, csrfToken = undefined) {
      return browser.request('/api/auth/signout', { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrfToken: csrfToken ?? await browser.csrf(), callbackUrl: '/login', json: 'true' }),
      });
    }
    await test('PDGLD-51: ciclo de sesiones y auditoría transaccional', { timeout: 120_000 }, async (t) => {
      await t.test('el login público sin sesión responde sin redirecciones HTTP', async () => {
        const browser = new Browser(baseUrl);
        for (let i = 0; i < 3; i++) {
          const response = await browser.request('/login');
          assert.equal(response.status, 200);
          assert.equal(response.headers.get('location'), null);
        }
        await browser.assertAccess(401, 'UNAUTHENTICATED');
      });
      await t.test('LOGIN_OK ocurre una vez por inicio y las lecturas no duplican eventos', async () => {
        const before = await count();
        const browser = await login();
        for (let i = 0; i < 3; i++) { await browser.session(); await browser.assertAccess(200); }
        await browser.updateSession({ action: 'activity' });
        assert.deepEqual(await count(), { logins: before.logins + 1, logouts: before.logouts });
        const events = (await db.query('SELECT * FROM sports_management.authentication_events WHERE user_id=$1', [user])).rows;
        const serialized = JSON.stringify(events);
        for (const secret of [password, hash, email, 'token_hash', 'password_hash', 'sid']) assert.ok(!serialized.includes(secret));
      });
      await t.test('cierres simultáneos y su repetición auditan una vez y conservan otra sesión', async () => {
        const first = await login();
        const second = await login();
        const csrfToken = await first.csrf();
        const replay = new Browser(baseUrl);
        replay.cookies = new Map(first.cookies);
        const saved = new Map(first.cookies);
        const before = await count();
        const results = await Promise.all([logout(first, csrfToken), logout(replay, csrfToken)]);
        assert.deepEqual(results.map((response) => response.status), [200, 200]);
        assert.deepEqual(await count(), { ...before, logouts: before.logouts + 1 });
        replay.cookies = saved;
        await replay.assertAccess(401, 'UNAUTHENTICATED');
        await second.assertAccess(200);
        assert.equal((await logout(replay, csrfToken)).status, 200);
        assert.deepEqual(await count(), { ...before, logouts: before.logouts + 1 });
      });
      await t.test('un fallo de revocación conserva cookie, sesión y auditoría; reintentar sí cierra', async () => {
        const browser = await login();
        await browser.assertAccess(200);
        const csrfToken = await browser.csrf();
        const cookies = new Map(browser.cookies);
        const before = await count();
        await db.query(`CREATE FUNCTION sports_management.pdgld51_fail_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN RAISE EXCEPTION 'Synthetic revoke failure'; END IF; RETURN NEW; END $$`);
        try {
          await db.query('CREATE TRIGGER pdgld51_fail_revoke BEFORE UPDATE ON sports_management.sessions FOR EACH ROW EXECUTE FUNCTION sports_management.pdgld51_fail_revoke()');
          const response = await logout(browser, csrfToken);
          assert.equal(response.status, 503);
          assert.deepEqual(await response.json(), { error: 'SIGNOUT_FAILED' });
          assert.deepEqual(browser.cookies, cookies);
          assert.deepEqual(await count(), before);
          await browser.assertAccess(200);
        } finally {
          await db.query('DROP TRIGGER IF EXISTS pdgld51_fail_revoke ON sports_management.sessions');
          await db.query('DROP FUNCTION IF EXISTS sports_management.pdgld51_fail_revoke()');
        }
        assert.equal((await logout(browser, csrfToken)).status, 200);
        assert.deepEqual(await count(), { ...before, logouts: before.logouts + 1 });
        browser.cookies = cookies;
        await browser.assertAccess(401, 'UNAUTHENTICATED');
      });
      await t.test('un fallo al auditar LOGOUT revierte también la revocación', async () => {
        const browser = await login();
        const csrfToken = await browser.csrf();
        const cookies = new Map(browser.cookies);
        const before = await count();
        await db.query(`CREATE FUNCTION sports_management.pdgld51_fail_logout_audit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.action='LOGOUT' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`);
        try {
          await db.query('CREATE TRIGGER pdgld51_fail_logout_audit BEFORE INSERT ON sports_management.authentication_events FOR EACH ROW EXECUTE FUNCTION sports_management.pdgld51_fail_logout_audit()');
          assert.equal((await logout(browser, csrfToken)).status, 503);
          assert.deepEqual(browser.cookies, cookies);
          assert.deepEqual(await count(), before);
          await browser.assertAccess(200);
        } finally {
          await db.query('DROP TRIGGER IF EXISTS pdgld51_fail_logout_audit ON sports_management.authentication_events');
          await db.query('DROP FUNCTION IF EXISTS sports_management.pdgld51_fail_logout_audit()');
        }
        assert.equal((await logout(browser, csrfToken)).status, 200);
      });
      await t.test('el plazo configurado en cinco minutos es efectivo y ampliarlo no revive una sesión rechazada', async () => {
        const browser = await login();
        const stored = (await db.query(`SELECT id,last_activity_at,expires_at FROM sports_management.sessions
          WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [user])).rows[0];
        const cookies = new Map(browser.cookies);
        try {
          await restartServer('5');
          const session = await browser.session();
          assert.equal(Date.parse(session.expires), stored.last_activity_at.getTime() + 5 * 60_000);
          await db.query("UPDATE sports_management.sessions SET last_activity_at=now()-interval '6 minutes' WHERE id=$1", [stored.id]);
          await browser.assertAccess(401, 'UNAUTHENTICATED');
          assert.ok((await db.query('SELECT revoked_at FROM sports_management.sessions WHERE id=$1', [stored.id])).rows[0].revoked_at);
        } finally { await restartServer('30'); }
        browser.cookies = cookies;
        await browser.assertAccess(401, 'UNAUTHENTICATED');
      });
    });
  } finally { await db.end(); }
}
