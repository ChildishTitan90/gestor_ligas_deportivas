import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { AFFILIATION_PLAN, assertProductionCreationAccess, assertAffiliationProductionSecurity } from './production-plans.mjs';

/** Solo fixtures transaccionales; también admite PostgreSQL embebido en la revisión. */
export async function verifyProductionSecurity(client) {
 try {
  await client.query('BEGIN');
  const count = (await client.query(`SELECT
    (SELECT count(*) FROM pg_namespace WHERE nspname IN ('auth','storage')) +
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS count`)).rows[0].count;
  assert.equal(Number(count), 0, 'La prueba exige un servicio PostgreSQL desechable sin marcadores de Supabase.');
  const sql = readFileSync(new URL(`../../prisma/migrations/${AFFILIATION_PLAN.securityMigration}/migration.sql`, import.meta.url), 'utf8');
  const rls = async () => (await client.query("SELECT relrowsecurity FROM pg_class WHERE oid='sports_management.club_affiliation_categories'::regclass")).rows[0].relrowsecurity;
  assert.equal(await rls(), false);
  await client.query(sql);
  assert.equal(await rls(), false, 'La migración conserva Docker sin RLS.');
  await client.query('CREATE SCHEMA auth');
  await assert.rejects(client.query(sql), /Marcadores parciales/);
  // El error revierte la transacción completa: reconstruir los fixtures de prueba.
  await client.query('ROLLBACK');
  await client.query('BEGIN');
  await client.query('CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await assertProductionCreationAccess(client);
  await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA sports_management GRANT SELECT ON TABLES TO anon');
  await assert.rejects(assertProductionCreationAccess(client), /DEFAULT PRIVILEGES/);
  await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA sports_management REVOKE SELECT ON TABLES FROM anon');
  await client.query('GRANT USAGE ON SCHEMA sports_management TO anon,authenticated,service_role');
  await client.query('GRANT SELECT,INSERT ON sports_management.club_affiliation_categories TO anon,authenticated,service_role');
  await client.query(sql);
  await assertAffiliationProductionSecurity(client);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await client.query('SAVEPOINT denied_api');
    await client.query(`SET LOCAL ROLE ${role}`);
    await assert.rejects(client.query('SELECT * FROM sports_management.club_affiliation_categories'), { code: '42501' });
    await client.query('ROLLBACK TO SAVEPOINT denied_api');
    // Incluso un GRANT accidental queda sujeto a la denegación RLS sin políticas.
    await client.query(`GRANT SELECT,INSERT ON sports_management.club_affiliation_categories TO ${role}`);
    await assert.rejects(assertAffiliationProductionSecurity(client), /expuesta/);
    if (role !== 'service_role') {
      await client.query('SAVEPOINT denied_rls');
      await client.query(`SET LOCAL ROLE ${role}`);
      assert.equal(Number((await client.query('SELECT count(*) FROM sports_management.club_affiliation_categories')).rows[0].count), 0);
      await assert.rejects(client.query(`INSERT INTO sports_management.club_affiliation_categories(affiliation_id,season_id,category_id)
        VALUES (gen_random_uuid(),gen_random_uuid(),gen_random_uuid())`), { code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT denied_rls');
    }
    await client.query(`REVOKE ALL ON sports_management.club_affiliation_categories FROM ${role}`);
  }
  await assertAffiliationProductionSecurity(client);
  await client.query('SELECT count(*) FROM sports_management.club_affiliation_categories');
  console.log('PDGLD-57: entorno local intacto, marcadores parciales rechazados, ACL iniciales verificadas, RLS y roles API comprobados.');
 } finally {
   await client.query('ROLLBACK');
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 // Solo la base desechable del servicio PostgreSQL de CI. No carga archivos .env.
 assert.equal(process.env.CI, 'true');
 const target = new URL(process.env.DIRECT_URL ?? '');
 assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
 assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
 assert.ok(['5432', '5433'].includes(target.port));
 assert.ok(target.pathname === '/gestor_ligas_ci' || /^\/pdgld57_security_[a-f0-9]{16}$/.test(target.pathname));
 assert.equal(target.hash, '');
 for (const [key, value] of target.searchParams) assert.ok(key === 'schema' && value === 'public');
 const client = new pg.Client({ connectionString: target.href });
 try {
   await client.connect();
   await verifyProductionSecurity(client);
 } catch (error) {
   // Solo identificadores seguros: no registrar conexiones, SQL o parámetros.
   console.error('Falló la prueba de seguridad de producción:', error.code ?? error.name);
   process.exitCode = 1;
 } finally {
   await client.end();
 }
}
