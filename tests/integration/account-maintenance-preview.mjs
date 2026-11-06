import assert from 'node:assert/strict';
import pg from 'pg';
import { PREVIEW_ROLE } from '../../scripts/preview/runtime-plan.mjs';
import { verifyPreviewMaintenance } from './preview-runtime.mjs';
import { verifyPreviewPrismaAccountCreation } from './preview-prisma-account.mjs';

/** La conexión limitada es independiente de la usada para fixtures/observación. */
export async function verifyAccountMaintenancePreview({ databaseUrl, runtimeDatabaseUrl }, work) {
  const ownerTarget = new URL(databaseUrl), target = new URL(runtimeDatabaseUrl);
  assert.equal(ownerTarget.username, 'postgres');
  assert.equal(target.username, PREVIEW_ROLE);
  assert.equal(target.hostname, '127.0.0.1');
  assert.ok(['55415','55417'].includes(target.port));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search+target.hash, '');
  assert.equal(target.host+target.pathname, ownerTarget.host+ownerTarget.pathname);
  const runtime = new pg.Client({ connectionString: runtimeDatabaseUrl });
  const owner = new pg.Client({ connectionString: databaseUrl });
  await owner.connect();
  try {
    await runtime.connect();
    const identity = (await runtime.query(`SELECT current_user AS actor,session_user AS login,
      row_security_active('sports_management.users') AS users_rls,
      row_security_active('sports_management.sessions') AS sessions_rls,
      row_security_active('sports_management.audit_logs') AS audit_rls`)).rows[0];
    assert.deepEqual(identity, { actor:PREVIEW_ROLE,login:PREVIEW_ROLE,users_rls:true,sessions_rls:true,audit_rls:true });
    const columns = (await runtime.query(`SELECT attname AS name,
      has_column_privilege(current_user,'sports_management.users',attname,'UPDATE') AS allowed
      FROM pg_attribute WHERE attrelid='sports_management.users'::regclass AND attnum>0 AND NOT attisdropped`)).rows;
    assert.deepEqual(columns.filter(row=>row.allowed).map(row=>row.name).sort(),
      ['password_hash','must_change_password','failed_login_attempts','locked_until','version','username','email','is_active','maintenance_revision'].sort());
    for (const table of ['users','sessions','audit_logs','roles','user_roles']) {
      assert.equal((await runtime.query(`SELECT has_table_privilege(current_user,$1,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS extra`,[`sports_management.${table}`])).rows[0].extra,false);
    }
    const flags=(await owner.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=$1',[PREVIEW_ROLE])).rows[0];
    assert.ok(Object.values(flags).every(flag=>flag===false));
    assert.equal((await owner.query('SELECT count(*)::int AS n FROM pg_auth_members WHERE member=$1::regrole OR roleid=$1::regrole',[PREVIEW_ROLE])).rows[0].n,0);
    for (const sql of [
      'UPDATE sports_management.users SET id=id WHERE false',
      'UPDATE sports_management.users SET person_id=person_id WHERE false',
      'UPDATE sports_management.users SET created_at=created_at WHERE false',
      'UPDATE sports_management.users SET encrypted_mfa_secret=encrypted_mfa_secret WHERE false',
      'UPDATE sports_management.people SET first_name=first_name WHERE false',
      'UPDATE sports_management.sessions SET token_hash=token_hash WHERE false',
      'UPDATE sports_management.sessions SET user_id=user_id WHERE false',
      'UPDATE sports_management.audit_logs SET reason=reason WHERE false',
      'UPDATE sports_management.roles SET name=name WHERE false',
      'UPDATE sports_management.user_roles SET role_id=role_id WHERE false',
      'SELECT * FROM public._prisma_migrations',
    ]) await assert.rejects(runtime.query(sql),{code:'42501'});
    await verifyPreviewPrismaAccountCreation({ databaseUrl:runtimeDatabaseUrl });
    await work();
    const applicationSessions=(await owner.query(`SELECT usename FROM pg_stat_activity WHERE datname=current_database()
      AND application_name='pdgld118-maintenance-preview'`)).rows;
    assert.ok(applicationSessions.length>0,'La aplicación debe mantener una conexión identificada del perfil.');
    assert.ok(applicationSessions.every(row=>row.usename===PREVIEW_ROLE),'Next debe ejecutar las rutas con el LOGIN limitado.');
    // Incluye normalización idempotente de ACL/políticas, aislamiento público y ledger.
    await verifyPreviewMaintenance(owner);
  } finally {
    await runtime.end().catch(()=>{});
    await owner.end();
  }
}
