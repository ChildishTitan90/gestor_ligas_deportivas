import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import pg from 'pg';
import { assertAppliedHistory, assertProductionSql, productionConnection, readMigrations, redact } from './migration-helpers.mjs';

const { Client } = pg;
let client, directory, certificatePath, connection;
const migrationsPath = resolve('prisma/migrations');

function prisma(args) {
  const run = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), ...args], {
    env: { ...process.env, DIRECT_URL: connection.href }, encoding: 'utf8',
  });
  process.stdout.write(redact(run.stdout, [connection]));
  process.stderr.write(redact(run.stderr, [connection]));
  if (run.status !== 0) throw new Error('Prisma falló. Revisa la ejecución y corrige la migración; no se realiza reset ni resolve automático.');
}

async function securityState() {
  const tables = (await client.query("SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sports_management' AND c.relkind IN ('r','p') ORDER BY c.relname")).rows;
  if (!tables.length || tables.some(table => !table.relrowsecurity)) throw new Error('Hay tablas de producción sin RLS. Configura y revisa su seguridad antes del despliegue.');
  const access = (await client.query("SELECT rolname,has_table_privilege(rolname,'public._prisma_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS exposed FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")).rows;
  if (access.length !== 3 || access.some(role => role.exposed)) throw new Error('Los roles de API tienen acceso al historial de migraciones. Revísalo antes de desplegar.');
}

async function history() {
  return (await client.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY started_at')).rows;
}

try {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Este despliegue solo se ejecuta manualmente en GitHub Actions sobre main.');
  }
  const latest = spawnSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8' });
  if (latest.status !== 0 || latest.stdout.split(/\s/)[0] !== process.env.GITHUB_SHA) throw new Error('main cambió desde que comenzó esta ejecución. Inicia una nueva con la versión actual.');
  const certificate = process.env.SUPABASE_CA_CERT;
  if (!certificate?.includes('-----BEGIN CERTIFICATE-----')) throw new Error('Falta SUPABASE_CA_CERT en el environment supabase-production.');
  new X509Certificate(certificate);
  directory = mkdtempSync(join(tmpdir(), 'pdgld-supabase-'));
  certificatePath = join(directory, 'root.crt');
  writeFileSync(certificatePath, certificate, { mode: 0o600 });
  connection = productionConnection(process.env.SUPABASE_MIGRATION_URL, process.env.SUPABASE_PROJECT_REF, certificatePath);
  client = new Client({
    host: connection.hostname, port: Number(connection.port), database: 'postgres',
    user: decodeURIComponent(connection.username), password: decodeURIComponent(connection.password),
    connectionTimeoutMillis: 15000,
    ssl: { ca: certificate, rejectUnauthorized: true, servername: connection.hostname },
  });
  await client.connect();
  const migrations = readMigrations(migrationsPath);
  const applied = assertAppliedHistory(await history(), migrations);
  await securityState();
  for (const name of migrations.keys()) if (!applied.has(name)) {
    assertProductionSql(readFileSync(join(migrationsPath, name, 'migration.sql'), 'utf8'), name);
  }
  console.log(`Historial verificado; ${migrations.size - applied.size} migraciones pendientes.`);
  prisma(['migrate', 'deploy']);
  await securityState();
  const finalApplied = assertAppliedHistory(await history(), migrations);
  if (finalApplied.size !== migrations.size) throw new Error('Quedan migraciones sin aplicar.');
  prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']);
  prisma(['migrate', 'status']);
  console.log('Despliegue de migraciones terminado; historial, modelos y RLS verificados.');
} catch (error) {
  console.error(redact(error.message, connection ? [connection] : []));
  process.exitCode = 1;
} finally {
  if (client) await client.end();
  if (certificatePath) unlinkSync(certificatePath);
  if (directory) rmdirSync(directory);
}
