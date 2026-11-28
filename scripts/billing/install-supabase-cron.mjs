import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { productionConnection } from '../ci/migration-helpers.mjs';
import { PREVIEW_PROJECT } from '../preview/runtime-plan.mjs';

// No usa DATABASE_URL/DIRECT_URL: cada destino requiere conexión administrativa explícita.
dotenv.config({ path: '.env.local', quiet: true });
const target = process.argv.find(arg => arg.startsWith('--target='))?.slice(9);
assert.ok(['test', 'production'].includes(target), 'Usar --target=test o --target=production');
const prefix = `BILLING_CRON_${target.toUpperCase()}_`;
const required = name => {
  const value = process.env[prefix + name];
  if (!value) throw Error(`Falta ${prefix + name}; no se realizó ningún cambio remoto.`);
  return value;
};
let db;
try {
  const project = required('PROJECT_REF');
  assert.equal(project === PREVIEW_PROJECT, target === 'test', 'El destino no coincide con pruebas/producción');
  const certificateFile = required('CA_FILE');
  const certificate = readFileSync(certificateFile, 'utf8'); new X509Certificate(certificate);
  const connection = productionConnection(required('DATABASE_URL'), project, certificateFile);
  const app = new URL(required('APP_URL'));
  assert.equal(app.protocol, 'https:'); assert.equal(app.username + app.password, '');
  assert.equal(app.pathname, '/'); assert.equal(app.search + app.hash, '');
  const endpoint = new URL('/api/internal/billing/reconcile', app).href;
  const secret = required('SECRET'); assert.ok(secret.length >= 32);
  const headers = { authorization: `Bearer ${secret}`, 'x-billing-environment': target.toUpperCase(), 'x-billing-project': project };
  const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, 'El backend desplegado no confirmó el contrato de automatización');
  assert.deepEqual(await response.json(), { contract: 'billing-automation-v1', environment: target.toUpperCase(), projectRef: project }, 'La aplicación apunta a otro entorno/proyecto');
  db = new pg.Client({ host: connection.hostname, port: 5432, database: 'postgres',
    user: decodeURIComponent(connection.username), password: decodeURIComponent(connection.password),
    ssl: { ca: certificate, rejectUnauthorized: true, servername: connection.hostname }, connectionTimeoutMillis: 15000 });
  await db.connect();
  const { rows: [migration] } = await db.query("SELECT finished_at FROM public._prisma_migrations WHERE migration_name='20261128020000_billing_matchday_identity' AND rolled_back_at IS NULL");
  assert.ok(migration?.finished_at, 'Falta desplegar la migración revisada antes de Cron');
  if (!process.argv.includes('--apply')) {
    console.log(`Comprobaciones de ${target} correctas. --apply instala o actualiza una única tarea; no activa tarifas.`);
  } else {
    await db.query('BEGIN');
    await db.query('CREATE EXTENSION IF NOT EXISTS pg_cron');
    await db.query('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions');
    const tokenName = `pdgld77_billing_${target}_authorization`, urlName = `pdgld77_billing_${target}_url`;
    for (const [name, value] of [[tokenName, `Bearer ${secret}`], [urlName, endpoint]]) {
      const { rows: [prior] } = await db.query('SELECT id FROM vault.secrets WHERE name=$1', [name]);
      if (prior) await db.query('SELECT vault.update_secret($1,$2,$3)', [prior.id, value, name]);
      else await db.query('SELECT vault.create_secret($1,$2)', [value, name]);
    }
    // El comando almacenado solo contiene referencias a Vault; nunca el secreto.
    const command = `SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='${urlName}'),
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='${tokenName}'),
        'x-billing-environment','${target.toUpperCase()}','x-billing-project','${project}'),
      body := '{}'::jsonb, timeout_milliseconds := 55000);`;
    const jobName = `pdgld77-billing-reconcile-${target}`;
    await db.query('SELECT cron.schedule($1,$2,$3)', [jobName, '* * * * *', command]);
    const { rows } = await db.query('SELECT active,schedule FROM cron.job WHERE jobname=$1', [jobName]);
    assert.deepEqual(rows, [{ active: true, schedule: '* * * * *' }]);
    await db.query('COMMIT');
    console.log(`Cron ${target} confirmado: una tarea cada minuto. No se habilitó ninguna tarifa ni se emitieron cargos de prueba.`);
  }
} catch (error) {
  if (db) await db.query('ROLLBACK').catch(() => {});
  // No devolver errores SQL/HTTP que puedan incluir parámetros, conexiones o secretos.
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0]
    : String(error.message).startsWith('Falta BILLING_CRON_') ? error.message
      : 'No se confirmó la instalación de Cron. Revisa acceso administrativo, TLS, Vault y el contrato del backend; no se imprimen credenciales.');
  process.exitCode = 1;
} finally { await db?.end(); }
