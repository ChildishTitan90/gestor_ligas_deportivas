import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { tsImport } from 'tsx/esm/api';
import { Browser } from './auth.test.mjs';

/** Called after the baseline and before PDGLD-106, only in the exclusive DB. */
export async function prepareAccountDelegateFixtures(db, { databaseName } = {}) {
  const current = (await db.query('SELECT current_database() AS name')).rows[0].name;
  if (databaseName) {
    assert.match(databaseName, /^pdgld48_test_[a-f0-9]{16}$/); assert.equal(current, databaseName);
  } else assert.match(current, /^pdgld106_model_[a-f0-9]{16}$/);
  const password = `Fixture-${randomBytes(20).toString('hex')}!aA`;
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const id = async (sql, values = []) => (await db.query(sql, values)).rows[0].id;
  async function person() {
    const personId = await id("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Persona','Sintética') RETURNING id");
    const email = `${randomUUID()}@example.test`;
    const userId = await id(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
      VALUES ($1,$2,$2,$3,false) RETURNING id`, [personId, email, hash]);
    return { id: userId, email };
  }
  const actor = await person(); const legacy = await person(); const ordinary = await person();
  await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-107: fixtures HTTP exclusivos',false)", [actor.id]);
  const leagueId = await id('INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id', [`Fixture HTTP ${randomUUID()}`]);
  const clubs = [];
  for (let index = 0; index < 3; index++) clubs.push(await id(`INSERT INTO sports_management.clubs(league_id,reference_number,name)
    VALUES ($1,$2,'Club sintético HTTP') RETURNING id`, [leagueId, randomUUID()]));
  await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id)
    SELECT $1,id FROM sports_management.roles WHERE code='SUPERADMIN'`, [actor.id]);
  await db.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id,starts_at)
    SELECT $1,id,$2,$3,clock_timestamp()-interval '1 day' FROM sports_management.roles WHERE code='CLUB_DELEGATE'`, [legacy.id, leagueId, clubs[1]]);
  const { loadPermissionCatalog } = await tsImport('../../prisma/permissions-catalog.ts', import.meta.url);
  for (const grant of await loadPermissionCatalog()) {
    await db.query('INSERT INTO sports_management.permissions(module,action) VALUES ($1,$2) ON CONFLICT DO NOTHING', [grant.module, grant.action]);
    await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
      SELECT r.id,p.id,$4 FROM sports_management.roles r,sports_management.permissions p
      WHERE r.code=$1 AND p.module=$2 AND p.action=$3`, [grant.roleCode, grant.module, grant.action, grant.contextOnly]);
  }
  return { actor, legacy, ordinary, password, leagueId, clubs };
}

export async function verifyAccountDelegateHTTP({ db, baseUrl, fixture }) {
  assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
  const admin = new Browser(baseUrl);
  assert.equal((await admin.login(fixture.actor.email, fixture.password)).searchParams.has('error'), false);
  const params = clubId => new URLSearchParams({ leagueId: fixture.leagueId, clubKind: 'existing', clubId });
  const url = clubId => `/api/accounts/delegate-options?${params(clubId)}`;
  const formPage = await admin.request('/accounts/new');
  assert.equal(formPage.status, 200);
  assert.match(await formPage.text(), /href="\/access"/);
  assert.equal((await new Browser(baseUrl).request(url(fixture.clubs[0]))).status, 401);
  const ordinary = new Browser(baseUrl);
  await ordinary.login(fixture.ordinary.email, fixture.password);
  assert.equal((await ordinary.request(url(fixture.clubs[0]))).status, 403);
  const beforeOptions = await admin.request(url(fixture.clubs[0]));
  assert.equal(beforeOptions.status, 200);
  assert.match(beforeOptions.headers.get('cache-control'), /private.*no-store/);
  assert.ok((await beforeOptions.json()).positions.every(p => p.available));
  const forged = params(fixture.clubs[0]); forged.set('leagueId', randomUUID());
  assert.equal((await admin.request(`/api/accounts/delegate-options?${forged}`)).status, 403);
  const payload = (clubId, delegatePosition, delegatePeriod) => {
    const suffix = randomUUID();
    return { username: `fixture-${suffix}`, email: `${suffix}@example.test`, temporaryPassword: `Initial-${randomBytes(20).toString('hex')}!aA`,
      person: { firstName: 'Persona', paternalSurname: 'Sintética' }, roles: ['CLUB_DELEGATE'], leagueId: fixture.leagueId,
      club: { kind: 'existing', id: clubId }, delegatePosition, ...(delegatePeriod ? { delegatePeriod } : {}) };
  };
  const post = body => admin.request('/api/accounts', { method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify(body) });
  const totals = async () => (await db.query(`SELECT (SELECT count(*) FROM sports_management.people) people,
    (SELECT count(*) FROM sports_management.users) users,(SELECT count(*) FROM sports_management.user_roles) assignments,
    (SELECT count(*) FROM sports_management.audit_logs) audit`)).rows[0];
  async function rejected(body, code, status = 409) {
    const before = await totals(); const response = await post(body);
    assert.equal(response.status, status); assert.equal((await response.json()).code, code);
    assert.deepEqual(await totals(), before);
  }
  await rejected(payload(fixture.clubs[0], undefined), 'DELEGATE_POSITION_REQUIRED', 400);
  await rejected(payload(fixture.clubs[0], 'TITULAR'), 'INVALID_DELEGATE_POSITION', 400);
  for (const delegatePosition of ['PRIMARY', 'DEPUTY']) {
    const input = payload(fixture.clubs[0], delegatePosition);
    const response = await post(input); assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.assignments[0].delegatePosition, delegatePosition);
    const saved = (await db.query('SELECT delegate_position,ends_at FROM sports_management.user_roles WHERE user_id=$1', [result.id])).rows[0];
    assert.equal(saved.delegate_position, delegatePosition); assert.equal(saved.ends_at, null);
    if (delegatePosition === 'DEPUTY') {
      const browser = new Browser(baseUrl); await browser.login(input.email, input.temporaryPassword);
      const nextPassword = `Changed-${randomBytes(20).toString('hex')}!aA`;
      const changed = await browser.request('/api/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ currentPassword: input.temporaryPassword, newPassword: nextPassword, confirmPassword: nextPassword }) });
      assert.equal(changed.status, 200); await browser.login(input.email, nextPassword);
      const page = await browser.request('/access'); assert.equal(page.status, 200); assert.match(await page.text(), /Subdelegado/);
    }
  }
  const occupied = await admin.request(url(fixture.clubs[0]));
  assert.ok((await occupied.json()).positions.every(p => !p.available && p.reason === 'OCCUPIED'));
  await rejected(payload(fixture.clubs[0], 'PRIMARY'), 'DELEGATE_POSITION_OCCUPIED');
  const legacy = await admin.request(url(fixture.clubs[1]));
  assert.ok((await legacy.json()).positions.every(p => !p.available && p.reason === 'LEGACY'));
  await rejected(payload(fixture.clubs[1], 'DEPUTY'), 'DELEGATE_LEGACY_OVERLAP');
  const legacyBrowser = new Browser(baseUrl); await legacyBrowser.login(fixture.legacy.email, fixture.password);
  const legacyPage = await legacyBrowser.request('/access'); assert.equal(legacyPage.status, 200); assert.match(await legacyPage.text(), /Cargo no identificado/);
  assert.equal((await db.query('SELECT delegate_position FROM sports_management.user_roles WHERE user_id=$1', [fixture.legacy.id])).rows[0].delegate_position, null);
  const start = new Date(Date.now() + 86_400_000).toISOString();
  const cut = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const end = new Date(Date.now() + 3 * 86_400_000).toISOString();
  assert.equal((await post(payload(fixture.clubs[2], 'PRIMARY', { startsAt: start, endsAt: cut }))).status, 201);
  const availableAfter = params(fixture.clubs[2]); availableAfter.set('startsAt', cut); availableAfter.set('endsAt', end);
  assert.ok((await (await admin.request(`/api/accounts/delegate-options?${availableAfter}`)).json()).positions.every(p => p.available));
  assert.equal((await post(payload(fixture.clubs[2], 'PRIMARY', { startsAt: cut, endsAt: end }))).status, 201);
  await rejected(payload(fixture.clubs[2], 'PRIMARY', { startsAt: start, endsAt: end }), 'DELEGATE_POSITION_OCCUPIED');
  await rejected(payload(fixture.clubs[2], 'PRIMARY', { startsAt: end, endsAt: start }), 'VALIDATION_ERROR', 400);
  const createGrant = (await db.query(`SELECT rp.* FROM sports_management.role_permissions rp
    JOIN sports_management.roles r ON r.id=rp.role_id JOIN sports_management.permissions p ON p.id=rp.permission_id
    WHERE r.code='SUPERADMIN' AND p.module='users' AND p.action='CREATE'`)).rows[0];
  assert.ok(createGrant);
  await db.query('DELETE FROM sports_management.role_permissions WHERE id=$1', [createGrant.id]);
  try {
    assert.equal((await admin.request(url(fixture.clubs[0]))).status, 403);
    await rejected(payload(fixture.clubs[0], 'PRIMARY'), 'FORBIDDEN', 403);
  } finally {
    await db.query('INSERT INTO sports_management.role_permissions(id,role_id,permission_id,context_only) VALUES ($1,$2,$3,$4)',
      [createGrant.id, createGrant.role_id, createGrant.permission_id, createGrant.context_only]);
  }
}
