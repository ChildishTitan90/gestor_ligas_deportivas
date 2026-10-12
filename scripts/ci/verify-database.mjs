import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

// This smoke test is deliberately restricted to the disposable CI database.
// It does not load .env files and must never run against Supabase.
function validateTarget() {
  assert.equal(process.env.CI, 'true', 'Database verification requires CI=true.');
  assert.ok(process.env.DIRECT_URL, 'DIRECT_URL is required for the CI database.');

  let target;
  try {
    target = new URL(process.env.DIRECT_URL);
  } catch {
    assert.fail('DIRECT_URL must be a valid PostgreSQL connection URL.');
  }

  assert.ok(
    ['postgres:', 'postgresql:'].includes(target.protocol),
    'The CI connection must use PostgreSQL.',
  );
  assert.ok(
    ['localhost', '127.0.0.1'].includes(target.hostname),
    'Database verification only accepts localhost or 127.0.0.1.',
  );
  const expectedPort = process.env.CI_DB_PORT ?? '5432';
  assert.ok(['5432', '5433'].includes(expectedPort), 'Unsupported local CI port.');
  assert.equal(target.port, expectedPort, 'The CI database must use its configured local port.');
  assert.equal(
    target.pathname,
    '/gestor_ligas_ci',
    'Database verification only accepts gestor_ligas_ci.',
  );
  for (const [key, value] of target.searchParams) {
    // pg connection-string query parameters can override host and database.
    assert.ok(
      key === 'schema' && value === 'public',
      'Unexpected connection parameters are not allowed in the CI database URL.',
    );
  }
  assert.equal(target.hash, '', 'Connection URL fragments are not supported.');
  return target.href;
}

async function verifyObjects(client) {
  const { rows: tables } = await client.query(`
    SELECT count(*)::int AS count
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'sports_management' AND c.relkind IN ('r', 'p')
  `);
  // The baseline has 96 tables. Future migrations may add more.
  assert.ok(tables[0].count >= 96, 'The 96 baseline tables must be present.');

  const { rows: history } = await client.query(`
    SELECT migration_name
    FROM public._prisma_migrations
    WHERE migration_name = '0_init'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `);
  assert.equal(history.length, 1, 'The baseline must be successfully applied.');

  const { rows: column } = await client.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'sports_management'
      AND table_name = 'people' AND column_name = 'id'
  `);
  assert.equal(column[0]?.data_type, 'uuid', 'people.id must remain a UUID.');

  const { rows: constraints } = await client.query(`
    SELECT c.contype, pg_catalog.pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'sports_management.people'::regclass
  `);
  assert.ok(
    constraints.some(({ contype, definition }) =>
      contype === 'u' && /\bUNIQUE\s*\(curp\)/i.test(definition)),
    'CURP must have a database-level UNIQUE constraint.',
  );
  assert.ok(
    constraints.filter(({ contype, definition }) =>
      contype === 'c' && /\bcurp\b/i.test(definition)).length >= 2,
    'CURP format and birth-date CHECK constraints must be present.',
  );

  const { rows: views } = await client.query(`
    SELECT table_name
    FROM information_schema.views
    WHERE table_schema = 'sports_management'
      AND table_name = ANY($1::text[])
  `, [['charge_balances', 'public_portal_publications']]);
  assert.equal(views.length, 2, 'The baseline reporting views must be present.');

  const { rows: functions } = await client.query(`
    SELECT p.proname
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'sports_management'
      AND p.proname = ANY($1::text[]) AND p.pronargs = 0
  `, [[
    'audit_change', 'validate_player_registration',
    'validate_match_result', 'sync_match_reservations',
  ]]);
  assert.equal(
    new Set(functions.map(({ proname }) => proname)).size,
    4,
    'The baseline audit and validation functions must be present.',
  );

  const { rows: triggers } = await client.query(`
    SELECT c.relname AS table_name, t.tgname, t.tgenabled
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'sports_management' AND NOT t.tgisinternal
      AND (c.relname, t.tgname) IN (
        ('player_registrations', 'validate_player'),
        ('match_results', 'consistent_match_result'),
        ('matches', 'matches_reservations')
      )
  `);
  assert.equal(triggers.length, 3, 'The baseline validation triggers must exist.');
  assert.ok(
    triggers.every(({ tgenabled }) => ['O', 'A'].includes(tgenabled)),
    'The baseline validation triggers must be enabled for normal writes.',
  );

  console.log(`Database objects verified: ${tables[0].count} application tables and baseline SQL objects.`);
}

async function expectConstraintError(client, parameters, expectedCode, label) {
  await client.query('SAVEPOINT constraint_test');
  let caught;
  try {
    await insertPerson(client, ...parameters);
  } catch (error) {
    caught = error;
  } finally {
    // PostgreSQL aborts the transaction after a constraint error until rollback.
    await client.query('ROLLBACK TO SAVEPOINT constraint_test');
    await client.query('RELEASE SAVEPOINT constraint_test');
  }
  assert.equal(caught?.code, expectedCode, `${label} must be rejected by PostgreSQL.`);
}

async function insertPerson(client, id, curp, birthDate = '2000-01-01') {
  await client.query(`
    INSERT INTO sports_management.people
      (id, first_name, paternal_surname, birth_date, curp)
    VALUES ($1::uuid, 'CI synthetic person', 'Database verification', $2::date, $3)
  `, [id, birthDate, curp]);
}

async function verifyConstraintsAndRollback(client) {
  const ids = Array.from({ length: 5 }, () => randomUUID());
  const token = [...randomBytes(5)].map((byte) =>
    String.fromCharCode(65 + (byte % 26))).join('');
  const curp = `CAXX000101H${token}00`;
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await insertPerson(client, ids[0], curp);
    await expectConstraintError(client, [ids[1], curp], '23505', 'Duplicate CURP');
    await expectConstraintError(client, [ids[2], 'INVALID_CURP'], '23514', 'Invalid CURP format');
    await expectConstraintError(
      client, [ids[3], `EAXX000101H${token}00`, '2000-01-02'], '23514',
      'CURP and birth-date mismatch',
    );

    // This succeeds after the failed inserts, proving savepoint recovery works.
    await insertPerson(client, ids[4], `DAXX000101H${token}00`);
    const { rows: inside } = await client.query(`
      SELECT count(*)::int AS count
      FROM sports_management.people WHERE id = ANY($1::uuid[])
    `, [ids]);
    assert.equal(inside[0].count, 2, 'Only the two valid test inserts should exist.');

    await client.query('ROLLBACK');
    transactionOpen = false;
    const { rows: after } = await client.query(`
      SELECT count(*)::int AS count
      FROM sports_management.people WHERE id = ANY($1::uuid[])
    `, [ids]);
    assert.equal(after[0].count, 0, 'Transaction rollback must leave no synthetic rows.');
    console.log('CURP uniqueness, format, birth date, savepoints and atomic rollback verified.');
  } finally {
    if (transactionOpen) await client.query('ROLLBACK');
  }
}

let client;
try {
  const connectionString = validateTarget();
  client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 20_000,
    application_name: 'pdgld_ci_database_verification',
  });
  await client.connect();
  await client.query("SET statement_timeout = '15s'");
  await verifyObjects(client);
  await verifyConstraintsAndRollback(client);
} catch (error) {
  // Never print the connection string, credentials or arbitrary driver messages.
  const detail = error instanceof assert.AssertionError
    ? error.message
    : `PostgreSQL verification failed (code: ${error.code ?? 'unavailable'}).`;
  console.error(detail);
  process.exitCode = 1;
} finally {
  if (client) await client.end();
}
