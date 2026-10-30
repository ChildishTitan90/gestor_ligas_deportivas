import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PREVIEW_ROLE, runtimePrivileges } from '../../scripts/preview/runtime-plan.mjs';
import { Browser } from './auth.test.mjs';

/** Native SQL checks complement the real HTTP suite using this same runtime. */
export async function verifyAccountPreviewRuntime({ owner, connection, fixture }) {
  assert.equal(connection.host, '127.0.0.1');
  assert.ok([55415, 55417].includes(connection.port));
  assert.match(connection.database, /^pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(connection.user, PREVIEW_ROLE);
  const runtime = new pg.Client(connection);
  const counts = async () => (await owner.query(`SELECT
    (SELECT count(*) FROM sports_management.user_roles) roles,
    (SELECT count(*) FROM sports_management.audit_logs) audit`)).rows[0];
  const before = await counts();
  await runtime.connect();
  try {
    const identity = (await runtime.query(`SELECT current_user AS name,
      row_security_active('sports_management.user_roles') AS protected`)).rows[0];
    assert.deepEqual(identity, { name: PREVIEW_ROLE, protected: true });
    const attributes = (await owner.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit
      FROM pg_roles WHERE rolname=$1`, [PREVIEW_ROLE])).rows[0];
    assert.ok(Object.values(attributes).every(value => value === false));
    assert.equal((await owner.query(`SELECT count(*)::int n FROM pg_auth_members
      WHERE member=$1::regrole OR roleid=$1::regrole`, [PREVIEW_ROLE])).rows[0].n, 0);
    const acl = (await owner.query(`SELECT attname AS name,
      has_column_privilege($1,'sports_management.user_roles',attname,'INSERT') AS ins,
      has_column_privilege($1,'sports_management.user_roles',attname,'UPDATE') AS upd
      FROM pg_attribute WHERE attrelid='sports_management.user_roles'::regclass AND attnum>0 AND NOT attisdropped`, [PREVIEW_ROLE])).rows;
    assert.deepEqual(acl.filter(row => row.ins).map(row => row.name).sort(),
      ['user_id', 'role_id', 'league_id', 'club_id', 'starts_at', 'delegate_position', 'ends_at'].sort());
    // Existing UPDATE(id) supports FOR SHARE only; WITH CHECK(false) blocks writes.
    assert.deepEqual(acl.filter(row => row.upd).map(row => row.name), ['id']);
    assert.equal((await owner.query(`SELECT has_table_privilege($1,'sports_management.user_roles','DELETE,TRUNCATE,REFERENCES,TRIGGER') AS extra`, [PREVIEW_ROLE])).rows[0].extra, false);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await owner.query(`SELECT has_any_column_privilege($1,'sports_management.user_roles','SELECT,INSERT,UPDATE,REFERENCES') AS exposed`, [role])).rows[0].exposed, false);
    }
    assert.deepEqual(runtimePrivileges.insert.user_roles.slice().sort(), acl.filter(row => row.ins).map(row => row.name).sort());
    await runtime.query('BEGIN');
    for (const sql of [
      'UPDATE sports_management.user_roles SET delegate_position=delegate_position',
      'UPDATE sports_management.user_roles SET ends_at=ends_at',
      'UPDATE sports_management.user_roles SET id=id',
      'DELETE FROM sports_management.user_roles',
      'SELECT * FROM public._prisma_migrations',
      `INSERT INTO sports_management.user_roles(id,user_id,role_id) VALUES ('${randomUUID()}','${fixture.actor.id}','${randomUUID()}')`,
    ]) {
      await runtime.query('SAVEPOINT denied');
      await assert.rejects(runtime.query(sql), error => error.code === '42501');
      await runtime.query('ROLLBACK TO SAVEPOINT denied');
    }
    const role = (await runtime.query("SELECT id FROM sports_management.roles WHERE code='SECRETARY'")).rows[0].id;
    const insert = `INSERT INTO sports_management.user_roles(user_id,role_id,league_id,delegate_position,starts_at,ends_at)
      VALUES ($1,$2,$3,NULL,clock_timestamp(),clock_timestamp()+interval '1 day') RETURNING id`;
    await runtime.query('SAVEPOINT missing_actor');
    await assert.rejects(runtime.query(insert, [fixture.actor.id, role, fixture.leagueId]), error => error.code === 'P0001');
    await runtime.query('ROLLBACK TO SAVEPOINT missing_actor');
    await runtime.query("SELECT set_config('app.user_id',$1,true),set_config('app.reason','PDGLD-107: runtime acotado',true)", [fixture.actor.id]);
    const assignment = (await runtime.query(insert, [fixture.actor.id, role, fixture.leagueId])).rows[0].id;
    const audit = (await runtime.query("SELECT user_id,reason,new_data FROM sports_management.audit_logs WHERE entity_id=$1 AND table_name='user_roles' AND action='INSERT'", [assignment])).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].user_id, fixture.actor.id);
    assert.equal(audit[0].reason, 'PDGLD-107: runtime acotado');
    assert.equal(audit[0].new_data.delegate_position, null); assert.ok(audit[0].new_data.ends_at);
    await runtime.query('ROLLBACK');
    assert.deepEqual(await counts(), before);
    assert.equal((await owner.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='sports_management' AND NOT rowsecurity")).rows[0].n, 0);
    const events = (await owner.query(`SELECT user_id,entity_id,new_data FROM sports_management.audit_logs
      WHERE table_name='user_roles' AND action='INSERT'
        AND reason='PDGLD-34: alta autorizada de cuenta y contexto inicial'`)).rows;
    assert.equal(events.length, 4, 'Una auditoría por cada asignación HTTP de esta suite.');
    assert.equal(new Set(events.map(event => event.entity_id)).size, 4);
    assert.ok(events.every(event => event.user_id === fixture.actor.id && ['PRIMARY', 'DEPUTY'].includes(event.new_data.delegate_position)));
  } finally { await runtime.query('ROLLBACK').catch(() => {}); await runtime.end(); }
}

export async function verifyScopedAccountPreview({ owner, fixture, baseUrl }) {
  const person = (await owner.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Ámbito','Sintético') RETURNING id")).rows[0].id;
  const email = `${randomUUID()}@example.test`;
  const actor = (await owner.query(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
    SELECT $1,$2,$2,password_hash,false FROM sports_management.users WHERE id=$3 RETURNING id`, [person, email, fixture.actor.id])).rows[0].id;
  await owner.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-108: fixture de ámbito, no cambio de matriz',false)", [fixture.actor.id]);
  await owner.query(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id)
    SELECT $1,id,$2,$3 FROM sports_management.roles WHERE code='SUPERADMIN'`, [actor, fixture.leagueId, fixture.clubs[0]]);
  const browser = new Browser(baseUrl); await browser.login(email, fixture.password);
  const query = clubId => `/api/accounts/delegate-options?${new URLSearchParams({ leagueId: fixture.leagueId, clubKind: 'existing', clubId })}`;
  assert.equal((await browser.request(query(fixture.clubs[0]))).status, 200);
  assert.equal((await browser.request(query(fixture.clubs[1]))).status, 403);
  const response = await browser.request('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ username: `foreign-${randomUUID()}`, email: `${randomUUID()}@example.test`, temporaryPassword: fixture.password,
      person: { firstName: 'Denegada', paternalSurname: 'Sintética' }, roles: ['CLUB_DELEGATE'], leagueId: fixture.leagueId,
      club: { kind: 'existing', id: fixture.clubs[1] }, delegatePosition: 'PRIMARY' }) });
  assert.equal(response.status, 403); assert.equal((await response.json()).code, 'FORBIDDEN');
}
