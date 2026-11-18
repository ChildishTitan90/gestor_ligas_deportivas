import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import pg from 'pg';
import dotenv from 'dotenv';
import { runtimePrivileges, schedulingLoanWindowColumns } from './preview/runtime-plan.mjs';

dotenv.config({ quiet: true });
const target = new URL(process.env.DIRECT_URL ?? '');
if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || !['5432','5433'].includes(target.port || '5432'))
  throw new Error('Solo se admite PostgreSQL local para esta prueba.');
target.search = ''; target.pathname = '/postgres';
const name = `pdgld135_test_${randomBytes(8).toString('hex')}`;
const role = `pdgld135_role_${randomBytes(8).toString('hex')}`;
const admin = new pg.Client({ connectionString: target.href });
let db; let created = false; let roleCreated = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  target.pathname = `/${name}`;
  db = new pg.Client({ connectionString: target.href }); await db.connect();
  for (const migration of (await readdir('prisma/migrations')).sort()) {
    if (migration === 'migration_lock.toml') continue;
    await db.query(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
  }
  // Contrato sintético mínimo. No aplica ni acredita la migración pendiente de Karol.
  await db.query(`ALTER TABLE sports_management.venue_loans ADD COLUMN IF NOT EXISTS requested_by uuid;
    ALTER TABLE sports_management.venue_loans ADD COLUMN IF NOT EXISTS requested_windows jsonb;`);
  await db.query(await readFile('tests/integration/scheduling-fixtures.sql','utf8'));
  await admin.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`); roleCreated=true;
  await db.query(`GRANT USAGE ON SCHEMA sports_management TO "${role}"`);
  const quote = value => '"'+value.replaceAll('"','""')+'"';
  // Mismas ACL por tabla/columna del plan; Docker conserva RLS desactivado.
  for(const table of runtimePrivileges.read) {
    const columns=table==='venue_loans'?[...runtimePrivileges.readColumns[table],...schedulingLoanWindowColumns]:runtimePrivileges.readColumns[table];
    await db.query(`GRANT SELECT ${columns?.length?'('+columns.map(quote).join(',')+')':''} ON sports_management.${quote(table)} TO "${role}"`);
    for(const [operation,plan] of [['INSERT',runtimePrivileges.insert],['UPDATE',runtimePrivileges.update]]) {
      const cols=plan[table];
      if(cols?.length) await db.query(`GRANT ${operation} (${cols.map(quote).join(',')}) ON sports_management.${quote(table)} TO "${role}"`);
    }
    if(runtimePrivileges.lock.includes(table)) await db.query(`GRANT UPDATE (id) ON sports_management.${quote(table)} TO "${role}"`);
  }
  const code = await new Promise((resolve, reject) => {
    const args = process.argv.includes('--browser') ? ['tests/e2e/scheduling-navigation.mjs'] : ['--conditions=react-server','--import','tsx','--test','tests/integration/scheduling.test.ts'];
    const child = spawn(process.execPath, args, {
      env: { ...process.env, DATABASE_URL: target.href, DIRECT_URL: target.href, SCHEDULING_TEST_ROLE:role }, windowsHide: true,
      stdio: ['ignore','pipe','pipe'],
    });
    const output = chunk => process.stdout.write(chunk.toString().replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,'[conexión omitida]'));
    child.stdout.on('data',output); child.stderr.on('data',output);
    child.on('error',reject); child.on('exit',resolve);
  });
  if(code !== 0) process.exitCode = 1;
} catch(error) {
  console.error(`Prueba aislada falló: ${error.code ?? error.name}`);
  process.exitCode = 1;
} finally {
  if(db) await db.end();
  if(created) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);
    await admin.query(`DROP DATABASE "${name}"`);
    console.log('Base temporal eliminada.');
  }
  if(roleCreated) await admin.query(`DROP ROLE "${role}"`);
  await admin.end();
}
