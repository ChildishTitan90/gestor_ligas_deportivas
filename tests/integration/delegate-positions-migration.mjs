import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { verifyRepresentativeAgreedRules } from './representative-agreed-rules.mjs';

/** Disposable fixtures only. The isolated supervisor pins/inspects the endpoint. */
export async function verifyDelegatePositionMigration(databaseUrl, options = {}) {
  const target = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  if (options.expectedPort !== undefined) {
    assert.ok([55415, 55417].includes(options.expectedPort));
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(Number(target.port), options.expectedPort);
    assert.match(options.databaseName ?? '', /^pdgld106_model_[a-f0-9]{16}$/);
  } else assert.ok(['5432', '5433'].includes(target.port || '5432'));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search, '');
  assert.equal(target.hash, '');
  const databaseName = options.databaseName ?? `pdgld106_model_${randomBytes(8).toString('hex')}`;
  assert.match(databaseName, /^pdgld106_model_[a-f0-9]{16}$/);
  const admin = new pg.Client({ connectionString: databaseUrl });
  const clients = [];
  let created = false;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    target.pathname = `/${databaseName}`;
    async function connect() {
      const client = new pg.Client({ connectionString: target.href });
      await client.connect();
      clients.push(client);
      await client.query("SET statement_timeout = '8s'");
      return client;
    }
    const db = await connect();
    const directory = new URL('../../prisma/migrations/', import.meta.url);
    const migration = '20261028010000_pdgld106_delegate_positions';
    for (const name of readdirSync(directory).filter(name => name < migration && /^\d/.test(name)).sort())
      await db.query(readFileSync(new URL(`${name}/migration.sql`, directory), 'utf8'));
    const id = async (sql, values = []) => (await db.query(sql, values)).rows[0].id;
    async function person() {
      const personId = await id("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Fixture','Representante') RETURNING id");
      const unique = randomUUID();
      return id(`INSERT INTO sports_management.users(person_id,username,email,password_hash)
        VALUES ($1,$2,$3,'synthetic-without-login') RETURNING id`, [personId, unique, `${unique}@example.test`]);
    }
    const [actor, other, third] = await Promise.all([person(), person(), person()]);
    const actorPerson = (await db.query('SELECT person_id FROM sports_management.users WHERE id=$1', [actor])).rows[0].person_id;
    const duplicateName = randomUUID();
    await assert.rejects(db.query(`INSERT INTO sports_management.users(person_id,username,email,password_hash)
      VALUES ($1,$2,$3,'synthetic-without-login')`, [actorPerson, duplicateName, `${duplicateName}@example.test`]),
    error => error.code === '23505', 'Una persona no puede tener dos cuentas para ocupar ambos cargos.');
    const role = await id("SELECT id FROM sports_management.roles WHERE code='CLUB_DELEGATE'");
    const secretary = await id("SELECT id FROM sports_management.roles WHERE code='SECRETARY'");
    const league = await id("INSERT INTO sports_management.leagues(name) VALUES ('Fixture PDGLD-106') RETURNING id");
    const club = async () => id("INSERT INTO sports_management.clubs(league_id,name,reference_number) VALUES ($1,'Fixture',$2) RETURNING id", [league, randomUUID()]);
    const [legacyClub, cleanClub, concurrencyClub] = await Promise.all([club(), club(), club()]);
    async function audit(client) {
      await client.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-106: fixture del modelo',false)", [actor]);
    }
    await audit(db);
    const legacy = await id(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id,starts_at)
      VALUES ($1,$2,$3,$4,'2026-01-01T00:00:00Z') RETURNING id`, [actor, role, league, legacyClub]);
    // Deliberately preserve a preexisting duplicate, without choosing a winner.
    const legacyDuplicate = await id(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id,starts_at,ends_at)
      VALUES ($1,$2,$3,$4,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z') RETURNING id`, [actor, role, league, legacyClub]);
    const classifiableClub = await club();
    const classifiable = await id(`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id,starts_at)
      VALUES ($1,$2,$3,$4,'2026-01-01T00:00:00Z') RETURNING id`, [third, role, league, classifiableClub]);
    const snapshot = async () => ({
      rows: (await db.query('SELECT id,user_id,role_id,club_id,league_id,starts_at,ends_at FROM sports_management.user_roles ORDER BY id')).rows,
      audit: (await db.query('SELECT * FROM sports_management.audit_logs ORDER BY id')).rows,
    });
    const before = await snapshot();
    await db.query(readFileSync(new URL(`${migration}/migration.sql`, directory), 'utf8'));
    assert.deepEqual(await snapshot(), before, 'Migration changes neither history nor audit.');
    assert.equal((await db.query('SELECT delegate_position FROM sports_management.user_roles WHERE id=$1', [legacy])).rows[0].delegate_position, null);
    await db.query("UPDATE sports_management.user_roles SET delegate_position='DEPUTY' WHERE id=$1", [classifiable]);
    const classificationAudit = (await db.query("SELECT previous_data,new_data FROM sports_management.audit_logs WHERE entity_id=$1 AND action='UPDATE'", [classifiable])).rows;
    assert.equal(classificationAudit.length, 1);
    assert.equal(classificationAudit[0].previous_data.delegate_position, null);
    assert.equal(classificationAudit[0].new_data.delegate_position, 'DEPUTY');

    const insertSql = `INSERT INTO sports_management.user_roles
      (user_id,role_id,league_id,club_id,delegate_position,starts_at,ends_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`;
    const designation = (user, clubId, position, start = new Date(Date.now() + 86_400_000), end = null) =>
      [user, role, league, clubId, position, start, end];
    const insert = async (values, client = db) => (await client.query(insertSql, values)).rows[0].id;
    const rejects = (work, constraint, code = '23514') => assert.rejects(work,
      error => error.code === code && error.constraint === constraint);

    await rejects(insert(designation(other, cleanClub, null)), 'user_roles_delegate_position_required');
    await rejects(insert(designation(other, cleanClub, 'OTHER')), 'user_roles_delegate_position_value');
    const wrongRole = designation(other, cleanClub, 'PRIMARY');
    wrongRole[1] = secretary;
    await rejects(insert(wrongRole), 'user_roles_delegate_role');
    const noClub = designation(other, null, 'PRIMARY');
    await assert.rejects(insert(noClub), error => error.code === '23514');
    const foreignLeague = await id("INSERT INTO sports_management.leagues(name) VALUES ('Fixture ajena') RETURNING id");
    const wrongLeague = designation(other, cleanClub, 'PRIMARY');
    wrongLeague[2] = foreignLeague;
    await assert.rejects(insert(wrongLeague), error => error.code === '23503');
    await rejects(insert(designation(other, legacyClub, 'PRIMARY')), 'user_roles_delegate_legacy_overlap', '23P01');
    await rejects(db.query('DELETE FROM sports_management.user_roles WHERE id=$1', [legacy]), 'user_roles_delegate_history');
    await rejects(db.query("UPDATE sports_management.user_roles SET starts_at='2025-01-01T00:00:00Z' WHERE id=$1", [legacy]), 'user_roles_delegate_history');

    const future = offset => new Date(Date.now() + offset * 86_400_000);
    const cut = future(4);
    const earlierCut = future(2);
    const knownStart = new Date(Date.now() - 3_600_000);
    const primary = await insert(designation(actor, cleanClub, 'PRIMARY', knownStart, future(1)));
    await rejects(insert(designation(actor, cleanClub, 'DEPUTY', knownStart, future(1))), 'user_roles_delegate_account_overlap', '23P01');
    const deputy = await insert(designation(other, cleanClub, 'DEPUTY', knownStart));
    await rejects(insert(designation(third, cleanClub, 'PRIMARY', knownStart)), 'user_roles_delegate_position_overlap', '23P01');
    const primaryEnd = (await db.query('SELECT ends_at FROM sports_management.user_roles WHERE id=$1', [primary])).rows[0].ends_at;
    await insert(designation(third, cleanClub, 'PRIMARY', primaryEnd));
    assert.equal((await db.query('SELECT delegate_position FROM sports_management.user_roles WHERE id=$1', [deputy])).rows[0].delegate_position, 'DEPUTY');
    await rejects(db.query("UPDATE sports_management.user_roles SET delegate_position='DEPUTY' WHERE id=$1", [primary]), 'user_roles_delegate_history');
    await rejects(db.query('DELETE FROM sports_management.user_roles WHERE id=$1', [primary]), 'user_roles_delegate_history');
    // Extending an active period is permitted when capacity remains available.
    const extendClub = await club();
    const extend = await insert(designation(actor, extendClub, 'PRIMARY', knownStart, future(1)));
    await db.query('UPDATE sports_management.user_roles SET ends_at=$2 WHERE id=$1', [extend, future(2)]);
    // Future assignments can be corrected or cancelled, with the same audit trigger.
    const plannedClub = await club();
    const planned = await insert(designation(actor, plannedClub, 'PRIMARY', future(5)));
    await db.query("UPDATE sports_management.user_roles SET delegate_position='DEPUTY' WHERE id=$1", [planned]);
    await rejects(db.query('UPDATE sports_management.user_roles SET delegate_position=NULL WHERE id=$1', [planned]), 'user_roles_delegate_position_required');
    await db.query('DELETE FROM sports_management.user_roles WHERE id=$1', [planned]);
    await rejects(db.query("UPDATE sports_management.roles SET code='RENAMED' WHERE id=$1", [role]), 'roles_delegate_identity_stable');
    await rejects(db.query('UPDATE sports_management.roles SET id=$2 WHERE id=$1', [role, randomUUID()]), 'roles_delegate_identity_stable');
    await rejects(db.query('DELETE FROM sports_management.roles WHERE id=$1', [role]), 'roles_delegate_identity_stable');
    await db.query("UPDATE sports_management.roles SET name='Delegado sintético' WHERE id=$1", [role]);
    // Another legacy still blocks explicit classification of this entire period.
    await rejects(db.query("UPDATE sports_management.user_roles SET delegate_position='PRIMARY' WHERE id=$1", [legacy]), 'user_roles_delegate_legacy_overlap', '23P01');
    await db.query('UPDATE sports_management.user_roles SET ends_at=$2 WHERE id=$1', [legacy, cut]);
    await insert(designation(other, legacyClub, 'PRIMARY', cut));
    assert.equal((await db.query('SELECT delegate_position FROM sports_management.user_roles WHERE id=$1', [legacyDuplicate])).rows[0].delegate_position, null);

    const left = await connect();
    const right = await connect();
    await audit(left);
    await audit(right);
    async function awaitBlock() {
      for (let attempt = 0; attempt < 150; attempt++) {
        if ((await db.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [right.processID])).rows[0].blocked) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail('The designation must wait for the uncommitted legacy closure.');
    }
    // An uncommitted closure must never release the ambiguous reservation.
    await left.query('BEGIN');
    await left.query('UPDATE sports_management.user_roles SET ends_at=$2 WHERE id=$1', [legacy, earlierCut]);
    const waiting = insert(designation(third, legacyClub, 'DEPUTY', earlierCut, cut), right)
      .then(value => ({ value }), error => ({ error }));
    await awaitBlock();
    await left.query('ROLLBACK');
    assert.equal((await waiting).error?.constraint, 'user_roles_delegate_legacy_overlap');
    await left.query('BEGIN');
    await left.query('UPDATE sports_management.user_roles SET ends_at=$2 WHERE id=$1', [legacy, earlierCut]);
    const committed = insert(designation(third, legacyClub, 'DEPUTY', earlierCut, cut), right)
      .then(value => ({ value }), error => ({ error }));
    await awaitBlock();
    await left.query('COMMIT');
    assert.ok((await committed).value);

    // No trigger rejects other isolation levels. Native exclusions must still
    // prevent conflicting commits; 40001/40P01 require a whole-transaction retry.
    for (const isolation of ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']) {
      const isolatedClub = await club();
      await left.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await insert(designation(actor, isolatedClub, 'PRIMARY', future(10)), left);
      const candidate = insert(designation(other, isolatedClub, 'PRIMARY', future(10)), right)
        .then(value => ({ value }), error => ({ error }));
      await awaitBlock();
      await left.query('COMMIT');
      const result = await candidate;
      assert.ok(['23P01', '40001', '40P01'].includes(result.error?.code));
      await right.query('ROLLBACK');
      // Independent nondelegate writes continue to work in the same isolation.
      await right.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await right.query(insertSql, [other, secretary, league, null, null, future(10), null]);
      await right.query('COMMIT');
    }
    const sameAccount = await Promise.allSettled([
      insert(designation(actor, concurrencyClub, 'PRIMARY', future(10)), left),
      insert(designation(actor, concurrencyClub, 'DEPUTY', future(10)), right),
    ]);
    assert.equal(sameAccount.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(sameAccount.find(result => result.status === 'rejected').reason.constraint, 'user_roles_delegate_account_overlap');

    const count = async () => (await db.query('SELECT count(*)::int n FROM sports_management.audit_logs')).rows[0].n;
    const rollbackClub = await club();
    const beforeAudit = await count();
    await db.query('BEGIN');
    const rolledBack = await insert(designation(actor, rollbackClub, 'PRIMARY', knownStart));
    await db.query('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.user_roles WHERE id=$1', [rolledBack])).rows[0].n, 0);
    assert.equal(await count(), beforeAudit);
    const audited = await insert(designation(actor, rollbackClub, 'PRIMARY', knownStart));
    const events = (await db.query("SELECT * FROM sports_management.audit_logs WHERE table_name='user_roles' AND entity_id=$1", [audited])).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].user_id, actor);
    assert.equal(events[0].new_data.delegate_position, 'PRIMARY');
    const beforeReplacement = await count();
    await db.query('BEGIN');
    await db.query('UPDATE sports_management.user_roles SET ends_at=$2 WHERE id=$1', [audited, cut]);
    await rejects(insert(designation(other, rollbackClub, 'PRIMARY', earlierCut)), 'user_roles_delegate_position_overlap', '23P01');
    await db.query('ROLLBACK');
    assert.equal((await db.query('SELECT ends_at FROM sports_management.user_roles WHERE id=$1', [audited])).rows[0].ends_at, null);
    assert.equal(await count(), beforeReplacement);
    return await verifyRepresentativeAgreedRules(db, target.href);
  } finally {
    const closed = await Promise.allSettled(clients.map(async client => {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }));
    try {
      if (created) {
        assert.match(databaseName, /^pdgld106_model_[a-f0-9]{16}$/);
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
        await admin.query(`DROP DATABASE "${databaseName}"`);
      }
      assert.ok(closed.every(result => result.status === 'fulfilled'), 'Alguna conexión de la suite no cerró correctamente.');
    } catch {
      throw new Error(`Cleanup PDGLD-106 incompleto: ${databaseName}; recuperar exclusivamente en el contenedor de esta ejecución.`);
    } finally { await admin.end(); }
  }
}
