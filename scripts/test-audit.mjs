import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {runtimePrivileges} from './preview/runtime-plan.mjs';

const target=new URL(process.env.DIRECT_URL??'');
assert.ok(['postgresql:','postgres:'].includes(target.protocol));
assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname));
assert.ok(['5432','5433','55491'].includes(target.port||'5432'));
assert.equal(target.search+target.hash,'');
target.pathname='/postgres';
const name=`pdgld91_test_${randomBytes(8).toString('hex')}`,role=`pdgld91_reader_${randomBytes(8).toString('hex')}`;
const admin=new pg.Client({connectionString:target.href});
let db,created=false,roleCreated=false,phase='conexión temporal';
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);created=true;
  target.pathname=`/${name}`;
  db=new pg.Client({connectionString:target.href});await db.connect();
  for(const migration of (await readdir('prisma/migrations')).sort()) {
    if(migration==='migration_lock.toml')continue;
    phase=`migración ${migration}`;
    await db.query(await readFile(`prisma/migrations/${migration}/migration.sql`,'utf8'));
  }
  phase='permisos de ejecución';
  await admin.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);roleCreated=true;
  await db.query(`GRANT USAGE ON SCHEMA sports_management TO "${role}"`);
  const quote=value=>'"'+value.replaceAll('"','""')+'"';
  for(const table of runtimePrivileges.read) {
    const cols=runtimePrivileges.readColumns[table];
    await db.query(`GRANT SELECT ${cols?.length?'('+cols.map(quote).join(',')+')':''} ON sports_management.${quote(table)} TO "${role}"`);
    const updates=runtimePrivileges.update[table];
    if(updates?.length)await db.query(`GRANT UPDATE (${updates.map(quote).join(',')}) ON sports_management.${quote(table)} TO "${role}"`);
    const inserts=runtimePrivileges.insert[table];
    if(inserts?.length)await db.query(`GRANT INSERT (${inserts.map(quote).join(',')}) ON sports_management.${quote(table)} TO "${role}"`);
    if(runtimePrivileges.lock.includes(table))await db.query(`GRANT UPDATE(id) ON sports_management.${quote(table)} TO "${role}"`);
  }
  phase='suite de bitácora';
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','--test','tests/integration/audit.test.ts'],{
      env:{...process.env,DATABASE_URL:target.href,DIRECT_URL:target.href,AUDIT_TEST_ROLE:role,AUDIT_TEST_RUN:'1',AUDIT_HTTP_TEST:process.argv.includes('--http')?'1':'0',AUDIT_BROWSER_TEST:process.argv.includes('--browser')?'1':'0'},
      windowsHide:true,stdio:['ignore','pipe','pipe'],
    });
    const output=chunk=>process.stdout.write(chunk.toString().replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,'[conexión omitida]'));
    child.stdout.on('data',output);child.stderr.on('data',output);
    child.on('error',reject);child.on('exit',resolve);
  });
  if(code!==0)process.exitCode=1;
} catch(error) {console.error(`Prueba de bitácora falló en ${phase}: ${error.code??error.name}`);process.exitCode=1;}
finally {
  if(db)await db.end();
  if(created){await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[name]);await admin.query(`DROP DATABASE "${name}"`);}
  if(roleCreated)await admin.query(`DROP ROLE "${role}"`);
  await admin.end();
  console.log('Recursos temporales de auditoría retirados.');
}
