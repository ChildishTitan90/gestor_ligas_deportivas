import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { assertAppliedHistory, readMigrations, redact } from '../ci/migration-helpers.mjs';
import { readProductionPlan, assertProductionCreationAccess, assertAppliedProductionSecurity } from '../ci/production-plans.mjs';
import { PREVIEW_MARKER, PREVIEW_ROLE, provisionPreviewRuntime } from './runtime-plan.mjs';
import { previewOwnerConnection, previewCommand, DEFAULT_PREVIEW_CA } from './connection.mjs';

// No carga .env ni usa la conexión del runtime o secretos de producción.
let client, connection;
try {
  const command = previewCommand(process.argv.slice(2));
  const caPath = resolve(process.env.PREVIEW_CA_CERT_PATH || DEFAULT_PREVIEW_CA);
  const certificate = readFileSync(caPath, 'utf8');
  connection = previewOwnerConnection(process.env.PREVIEW_OWNER_URL, caPath, certificate);
  client = new pg.Client({ host: connection.hostname, port: 5432, database: 'postgres',
    user: decodeURIComponent(connection.username), password: decodeURIComponent(connection.password),
    connectionTimeoutMillis: 15000,
    ssl: { ca: certificate, rejectUnauthorized: true, servername: connection.hostname } });
  await client.connect();
  const { rows: [owner] } = await client.query(`SELECT current_user AS name,
    (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
    (SELECT coalesce(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname=current_database()) AS note,
    EXISTS(SELECT 1 FROM sports_management.audit_logs WHERE id='d3222026-1022-4000-8000-000000000099'
      AND table_name='demo_supabase_20261022' AND action='INSTALL') AS installed`);
  if (owner.name !== 'postgres' || !owner.tls || (!owner.note.includes(PREVIEW_MARKER) && !owner.installed))
    throw new Error('No se reconoce al propietario o la instalación TLS de pruebas.');
  const migrationsPath = resolve('prisma/migrations');
  const migrations = readMigrations(migrationsPath);
  const history = async () => assertAppliedHistory((await client.query(
    'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY started_at')).rows, migrations);
  const security = async applied => {
    const insecure = await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='sports_management' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity`);
    if (insecure.rows.length) throw new Error('Pruebas tiene tablas sin RLS; revisar sin corregir automáticamente.');
    const ledger = await client.query(`SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[]) AND (
      has_table_privilege(oid,'public._prisma_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
      has_any_column_privilege(oid,'public._prisma_migrations','SELECT,INSERT,UPDATE,REFERENCES'))`,
      [['anon', 'authenticated', 'service_role', PREVIEW_ROLE]]);
    if (ledger.rows.length) throw new Error('El ledger está expuesto; revisar sus permisos.');
    await assertAppliedProductionSecurity(client, applied);
  };
  let applied = await history();
  const plan = readProductionPlan(migrationsPath, migrations, applied);
  await security(applied);
  // También verifica marcadores completos cuando no hay creaciones pendientes.
  await assertProductionCreationAccess(client);
  const prisma = args => {
    const run = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), ...args], {
      env: { ...process.env, DIRECT_URL: connection.href }, encoding: 'utf8', windowsHide: true });
    process.stdout.write(redact(run.stdout, [connection]));
    process.stderr.write(redact(run.stderr, [connection]));
    if (run.status !== 0) throw new Error('Prisma no confirmó la operación; revisar sin reset, resolve ni db push.');
  };
  console.log(`Pruebas verificadas; ${migrations.size - applied.size} migraciones pendientes.`);
  if (command === 'migrate') {
    if (plan.pendingCreation || plan.pendingEnrollmentCreation) await assertProductionCreationAccess(client);
    prisma(['migrate', 'deploy']);
    applied = await history();
    if (applied.size !== migrations.size) throw new Error('Quedan migraciones pendientes.');
    await security(applied);
  }
  if (command === 'provision') {
    if (applied.size !== migrations.size) throw new Error('Aplicar primero las migraciones originales pendientes.');
    await provisionPreviewRuntime(client);
    await security(applied);
    console.log('Provisión de Preview aplicada; datos y credenciales conservados.');
  }
  if (applied.size === migrations.size) {
    prisma(['migrate', 'status']);
    prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code']);
  }
} catch (error) {
  console.error(redact(error.message, connection ? [connection] : []));
  process.exitCode = 1;
} finally { if (client) await client.end(); }
