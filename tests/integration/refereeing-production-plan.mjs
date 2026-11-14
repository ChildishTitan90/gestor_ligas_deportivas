import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import pg from 'pg';
import {readMigrations} from '../../scripts/ci/migration-helpers.mjs';
import {readProductionPlan,assertProductionCreationAccess,assertAppliedProductionSecurity} from '../../scripts/ci/production-plans.mjs';

/** Solo recibe la conexión del contenedor que creó el runner, nunca un .env. */
export async function verifyRefereeingProductionPlan(owner,adminUrl,database){
  assert.match(database,/^pdgld48_test_[a-f0-9]{16}$/);
  const name=`${database}_production`;
  await owner.query(`CREATE DATABASE "${name}"`);
  const target=new URL(adminUrl);target.pathname=`/${name}`;
  const db=new pg.Client({connectionString:target.href});
  try{
    await db.connect();
    const directory=resolve('prisma/migrations'),migrations=readMigrations(directory),applied=new Set();
    await db.query(readFileSync(join(directory,'0_init','migration.sql'),'utf8'));applied.add('0_init');
    // Marcadores y ACL sintéticos de Supabase; jamás se contacta un proyecto.
    await db.query('CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS');
    const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='sports_management'")).rows;
    for(const {tablename}of tables)await db.query(`ALTER TABLE sports_management."${tablename}" ENABLE ROW LEVEL SECURITY`);
    await assertProductionCreationAccess(db);
    readProductionPlan(directory,migrations,applied);
    for(const migration of migrations.keys()){
      if(applied.has(migration))continue;
      await db.query(readFileSync(join(directory,migration,'migration.sql'),'utf8'));
      applied.add(migration);
    }
    readProductionPlan(directory,migrations,applied); // Reintento sin pendientes.
    await assertAppliedProductionSecurity(db,applied);
    assert.equal(Number((await db.query("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sports_management' AND c.relkind='r' AND NOT c.relrowsecurity")).rows[0].count),0);
    for(const role of ['anon','authenticated','service_role']){
      await db.query('BEGIN');
      try{
        await db.query(`SET LOCAL ROLE ${role}`);
        await assert.rejects(db.query('SELECT * FROM sports_management.referee_presentation_credentials'),{code:'42501'});
      }finally{await db.query('ROLLBACK');}
    }
    await db.query('GRANT SELECT ON sports_management.referee_presentation_credentials TO authenticated');
    await assert.rejects(assertAppliedProductionSecurity(db,applied),/expuesta/);
    await db.query('REVOKE SELECT ON sports_management.referee_presentation_credentials FROM authenticated');
    await assertAppliedProductionSecurity(db,applied);
    console.log(JSON.stringify({suite:'PDGLD-143 plan de producción',supabase:'marcadores sintéticos locales',allMigrations:true,rls:true,apiRolesDenied:true,retryWithoutPending:true}));
  }finally{
    await db.end();
    await owner.query(`DROP DATABASE "${name}"`);
    await owner.query('DROP ROLE IF EXISTS anon,authenticated,service_role');
  }
}
