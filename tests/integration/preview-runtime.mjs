import assert from 'node:assert/strict';
import { previewRuntimeSql, provisionPreviewRuntime, runtimePrivileges, PREVIEW_MARKER, PREVIEW_ROLE } from '../../scripts/preview/runtime-plan.mjs';

/** Parámetros efectivos de pg, después de resolver su connectionString. */
export function assertPreviewFixtureTarget(connection, databaseName, { isolatedPort } = {}) {
  assert.match(databaseName, /^pdgld48_test_[a-f0-9]{16}$/);
  assert.ok(['localhost', '127.0.0.1', '::1', '[::1]'].includes(connection.host),
    'Los fixtures de Preview requieren una conexión loopback del cliente.');
  if (isolatedPort !== undefined) {
    assert.ok([55415, 55417].includes(isolatedPort));
    assert.equal(connection.host, '127.0.0.1');
    assert.equal(Number(connection.port), isolatedPort);
  } else assert.ok([5432, 5433].includes(Number(connection.port)), 'Puerto de fixture de Preview no permitido.');
  assert.equal(connection.database, databaseName, 'La conexión debe usar la base temporal creada por el harness.');
  assert.equal(connection.user, 'postgres', 'Los fixtures solo los prepara el propietario local.');
}

/** Solo lo invoca el harness después de crear una base con nombre aleatorio. */
export async function preparePreviewRuntime(client, databaseName, runtimePassword, options = {}) {
  assertPreviewFixtureTarget(client.connectionParameters, databaseName, options);
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
    // No depender de EXECUTE heredado de PUBLIC: las funciones llamadas desde
    // otras funciones deben quedar cubiertas por el plan explícito del backend.
    await client.query('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA sports_management FROM PUBLIC');
    // Reproducir el fallo original aun cuando SELECT sí está autorizado.
    await client.query(`GRANT USAGE ON SCHEMA sports_management TO gestor_ligas_preview;
      GRANT SELECT ON sports_management.permissions TO gestor_ligas_preview;
      CREATE POLICY preview_backend_read ON sports_management.permissions FOR SELECT TO gestor_ligas_preview USING (true);`);
    await client.query('SAVEPOINT original_failure');
    await client.query('SET LOCAL ROLE gestor_ligas_preview');
    await assert.rejects(client.query('SELECT id FROM sports_management.permissions FOR SHARE'), { code: '42501' });
    await client.query('ROLLBACK TO SAVEPOINT original_failure');
    // Estado anterior de Preview: estas tablas solo permitían bloquear id.
    // La actualización debe retirar ese permiso y sustituir su política conocida.
    for (const table of ['groups', 'seasons', 'season_categories', 'season_teams']) {
      await client.query(`GRANT UPDATE (id) ON sports_management.${table} TO gestor_ligas_preview;
        CREATE POLICY preview_backend_lock ON sports_management.${table} FOR UPDATE TO gestor_ligas_preview USING (true) WITH CHECK (false)`);
    }
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
    await client.query('SELECT id FROM sports_management.document_requirements FOR SHARE');
    await client.query('SELECT id FROM sports_management.document_types FOR SHARE');
    await client.query('SELECT id FROM sports_management.player_registrations FOR SHARE');
    await client.query(`UPDATE sports_management.player_registrations SET status=status,identity_review_status=identity_review_status WHERE false`);
    await client.query(`INSERT INTO sports_management.player_status_history(registration_id,previous_status,new_status,user_id,reason,created_at) SELECT gen_random_uuid(),'INELIGIBLE','ACTIVE',gen_random_uuid(),'synthetic',now() WHERE false`);
    await client.query('SELECT id,registration_id,file_id,status FROM sports_management.player_documents LIMIT 0');
    await client.query(`INSERT INTO sports_management.player_documents(registration_id,document_type_id,file_id,status)
      SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'PENDING' WHERE false`);
    await client.query(`INSERT INTO sports_management.audit_logs(id,user_id,action,table_name,entity_id)
      SELECT gen_random_uuid(),gen_random_uuid(),'PLAYER_DOCUMENT_PREPARED','player_documents',gen_random_uuid() WHERE false`);
    for (const sql of [
      'UPDATE sports_management.users SET person_id=person_id',
      'UPDATE sports_management.users SET encrypted_mfa_secret=encrypted_mfa_secret',
      `UPDATE sports_management.permissions SET id=id WHERE id='${permission.id}'`,
      'UPDATE sports_management.user_roles SET id=id',
      'UPDATE sports_management.roles SET id=id',
      'UPDATE sports_management.groups SET id=id',
      'UPDATE sports_management.groups SET season_id=season_id',
      'UPDATE sports_management.categories SET name=name',
      'UPDATE sports_management.seasons SET league_id=league_id',
      'UPDATE sports_management.season_categories SET category_id=category_id',
      'UPDATE sports_management.season_teams SET team_id=team_id',
      'UPDATE sports_management.competition_rules SET season_id=season_id',
      'UPDATE sports_management.competition_rule_parameters SET parameter_value=parameter_value',
      'DELETE FROM sports_management.competition_rules',
      'DELETE FROM sports_management.competition_rule_parameters',
      'DELETE FROM sports_management.match_results',
      'SELECT * FROM sports_management.imports',
      'SELECT * FROM sports_management.official_documents',
      'SELECT home_score FROM sports_management.match_results',
      'TRUNCATE sports_management.groups',
      'CREATE TABLE sports_management.preview_forbidden(id uuid)',
      'UPDATE sports_management.teams SET club_id=club_id',
      'UPDATE sports_management.season_teams SET status=status',
      'UPDATE sports_management.club_affiliations SET id=id',
      'UPDATE sports_management.club_affiliation_categories SET category_id=category_id',
      'UPDATE sports_management.player_documents SET file_id=file_id',
      'UPDATE sports_management.player_category_levels SET level=level',
      'UPDATE sports_management.player_category_participations SET request_hash=request_hash',
      'DELETE FROM sports_management.player_category_participations',
      'UPDATE sports_management.player_registrations SET person_id=person_id',
      'UPDATE sports_management.document_requirements SET quantity=quantity',
      'UPDATE sports_management.document_types SET name=name',
      'UPDATE sports_management.team_enrollment_operations SET outcome=outcome',
      'DELETE FROM sports_management.team_enrollment_operations',
      'SELECT * FROM public._prisma_migrations',
    ]) {
      await client.query('SAVEPOINT denied');
      await assert.rejects(client.query(sql), { code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT denied');
    }
    // La aprobación explícita escribe estado/validador; sus triggers mantienen
    // inmutable la versión aprobada también usando el LOGIN limitado.
    const approved = (await client.query(`SELECT r.id FROM sports_management.competition_rules r
      WHERE r.status='APPROVED' AND EXISTS(SELECT 1 FROM sports_management.competition_rule_parameters p
        WHERE p.competition_rule_id=r.id) LIMIT 1`)).rows[0];
    if (approved) {
      for (const sql of [
        "UPDATE sports_management.competition_rules SET status='DRAFT' WHERE id=$1",
        'UPDATE sports_management.competition_rule_parameters SET requires_validation=true WHERE competition_rule_id=$1',
      ]) {
        await client.query('SAVEPOINT approved_history');
        await assert.rejects(client.query(sql, [approved.id]), { code: 'P0001' });
        await client.query('ROLLBACK TO SAVEPOINT approved_history');
      }
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
      'ALTER TABLE sports_management.club_affiliations DISABLE TRIGGER guard_submission_identity',
      'GRANT SELECT ON public._prisma_migrations TO gestor_ligas_preview',
      'GRANT DELETE ON sports_management.teams TO PUBLIC',
      'GRANT anon TO gestor_ligas_preview',
      'CREATE POLICY unknown_preview_read ON sports_management.competition_rules FOR SELECT TO gestor_ligas_preview USING (false)',
      'CREATE POLICY unknown_public_update ON sports_management.groups FOR UPDATE TO PUBLIC USING (true)',
      'ALTER POLICY preview_backend_insert ON sports_management.competition_rules WITH CHECK (false)',
      'ALTER POLICY preview_backend_update ON sports_management.groups USING (false)',
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

/** Mantenimiento real después de las operaciones HTTP: conserva filas, RBAC y
 * credenciales/atributos; no concede acceso a clientes públicos ni al ledger. */
export async function verifyPreviewMaintenance(client) {
  const snapshot = async () => {
    const tables = {};
    for (const table of runtimePrivileges.read) {
      tables[table] = (await client.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS hash
        FROM sports_management.${table} t`)).rows[0].hash;
    }
    const role = (await client.query(`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig
      FROM pg_roles WHERE rolname=$1`, [PREVIEW_ROLE])).rows[0];
    return { tables, role };
  };
  const before = await snapshot();
  await provisionPreviewRuntime(client);
  await provisionPreviewRuntime(client);
  assert.deepEqual(await snapshot(), before, 'Provisión repetida conserva todos los datos y atributos del rol.');
  const role = before.role;
  for (const flag of ['rolsuper','rolcreatedb','rolcreaterole','rolinherit','rolreplication','rolbypassrls']) assert.equal(role[flag], false);
  assert.equal((await client.query(`SELECT count(*)::int n FROM pg_auth_members
    WHERE member=$1::regrole OR roleid=$1::regrole`, [PREVIEW_ROLE])).rows[0].n, 0);
  for (const table of runtimePrivileges.read) {
    for (const role of ['anon','authenticated']) {
      assert.equal((await client.query(`SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege($1,$2,'SELECT,INSERT,UPDATE,REFERENCES') AS allowed`, [role, `sports_management.${table}`])).rows[0].allowed, false);
    }
  }
  await verifyPreviewRuntime(client);
  console.log('Preview: mantenimiento repetido conserva datos, RF22, atributos y aislamiento de anon/authenticated.');
}
