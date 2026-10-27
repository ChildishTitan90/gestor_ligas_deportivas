import assert from 'node:assert/strict';
import { previewRuntimeSql, PREVIEW_MARKER, PREVIEW_ROLE } from '../../scripts/preview/runtime-plan.mjs';

/** Parámetros efectivos de pg, después de resolver su connectionString. */
export function assertPreviewFixtureTarget(connection, databaseName) {
  assert.match(databaseName, /^pdgld48_test_[a-f0-9]{16}$/);
  assert.ok(['localhost', '127.0.0.1', '::1', '[::1]'].includes(connection.host),
    'Los fixtures de Preview requieren una conexión loopback del cliente.');
  assert.ok([5432, 5433].includes(Number(connection.port)), 'Puerto de fixture de Preview no permitido.');
  assert.equal(connection.database, databaseName, 'La conexión debe usar la base temporal creada por el harness.');
  assert.equal(connection.user, 'postgres', 'Los fixtures solo los prepara el propietario local.');
}

/** Solo lo invoca el harness después de crear una base con nombre aleatorio. */
export async function preparePreviewRuntime(client, databaseName, runtimePassword) {
  assertPreviewFixtureTarget(client.connectionParameters, databaseName);
  const identity = (await client.query('SELECT current_database() AS database, current_user AS actor')).rows[0];
  assert.equal(identity.database, databaseName);
  assert.equal(identity.actor, 'postgres');
  assert.match(runtimePassword, /^[A-Za-z0-9_-]{43}$/);
  const roles = ['anon', 'authenticated', 'service_role', PREVIEW_ROLE];
  assert.equal((await client.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])', [roles])).rows.length, 0,
    'No modificar roles ajenos: la instancia de pruebas debe estar aislada.');
  await client.query('BEGIN');
  try {
    await client.query(`CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE ROLE gestor_ligas_preview LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOBYPASSRLS NOINHERIT;`);
    await client.query(`COMMENT ON DATABASE "${databaseName}" IS '${PREVIEW_MARKER}'`);
    await client.query(`DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='sports_management'
      LOOP EXECUTE format('ALTER TABLE sports_management.%I ENABLE ROW LEVEL SECURITY',t.tablename); END LOOP; END $$`);
    // Reproducir el fallo original aun cuando SELECT sí está autorizado.
    await client.query(`GRANT USAGE ON SCHEMA sports_management TO gestor_ligas_preview;
      GRANT SELECT ON sports_management.permissions TO gestor_ligas_preview;
      CREATE POLICY preview_backend_read ON sports_management.permissions FOR SELECT TO gestor_ligas_preview USING (true);`);
    await client.query('SAVEPOINT original_failure');
    await client.query('SET LOCAL ROLE gestor_ligas_preview');
    await assert.rejects(client.query('SELECT id FROM sports_management.permissions FOR SHARE'), { code: '42501' });
    await client.query('ROLLBACK TO SAVEPOINT original_failure');
    await client.query(previewRuntimeSql());
    await client.query(previewRuntimeSql()); // Mantenimiento idempotente sin cambiar RF22/datos.
    await client.query('SET LOCAL ROLE gestor_ligas_preview');
    await client.query('SELECT id FROM sports_management.permissions FOR SHARE');
    await client.query('RESET ROLE');
    await client.query('COMMIT');
    console.log('Preview: reproducido 42501; provisión repetible recupera FOR SHARE conservando RLS.');
    return roles;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export async function verifyPreviewRuntime(client) {
  const counts = async () => (await client.query(`SELECT
    (SELECT count(*)::int FROM sports_management.user_roles) roles,
    (SELECT count(*)::int FROM sports_management.permissions) permissions,
    (SELECT count(*)::int FROM sports_management.team_enrollment_operations) operations`)).rows[0];
  const before = await counts();
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE gestor_ligas_preview');
    assert.equal((await client.query('SELECT current_user name')).rows[0].name, PREVIEW_ROLE);
    const permission = (await client.query('SELECT id FROM sports_management.permissions LIMIT 1')).rows[0];
    assert.ok(permission);
    await client.query('SELECT id FROM sports_management.user_roles FOR SHARE');
    for (const sql of [
      `UPDATE sports_management.permissions SET id=id WHERE id='${permission.id}'`,
      'UPDATE sports_management.user_roles SET id=id',
      'UPDATE sports_management.roles SET id=id',
      'UPDATE sports_management.groups SET name=name',
      'UPDATE sports_management.teams SET name=name',
      'UPDATE sports_management.season_teams SET status=status',
      'UPDATE sports_management.club_affiliations SET id=id',
      'UPDATE sports_management.club_affiliation_categories SET category_id=category_id',
      'UPDATE sports_management.team_enrollment_operations SET outcome=outcome',
      'DELETE FROM sports_management.team_enrollment_operations',
      'SELECT * FROM public._prisma_migrations',
    ]) {
      await client.query('SAVEPOINT denied');
      await assert.rejects(client.query(sql), { code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT denied');
    }
    await client.query('RESET ROLE');
    await client.query('COMMIT');
    assert.deepEqual(await counts(), before);
    assert.equal((await client.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='sports_management' AND NOT rowsecurity`)).rows[0].n, 0);
    // Desviación: no sustituir una política desconocida por USING(true).
    await client.query('BEGIN');
    await client.query('ALTER POLICY preview_backend_lock ON sports_management.permissions USING (false)');
    await client.query('SAVEPOINT wrong_policy');
    await assert.rejects(client.query(previewRuntimeSql()), /Política distinta/);
    await client.query('ROLLBACK TO SAVEPOINT wrong_policy');
    await client.query('ROLLBACK');
    for (const mutation of [
      `COMMENT ON DATABASE "${(await client.query('SELECT current_database() name')).rows[0].name}" IS ''`,
      'ALTER TABLE sports_management.groups DISABLE ROW LEVEL SECURITY',
      'GRANT SELECT ON public._prisma_migrations TO gestor_ligas_preview',
      'GRANT DELETE ON sports_management.teams TO PUBLIC',
      'GRANT anon TO gestor_ligas_preview',
    ]) {
      await client.query('BEGIN');
      await client.query(mutation);
      await client.query('SAVEPOINT unsafe');
      await assert.rejects(client.query(previewRuntimeSql()));
      await client.query('ROLLBACK TO SAVEPOINT unsafe');
      await client.query('ROLLBACK');
    }
    console.log('Preview: bloqueos sin mutación, columnas inmutables, ledger denegado y datos/RLS conservados.');
  } finally { await client.query('ROLLBACK'); }
}
