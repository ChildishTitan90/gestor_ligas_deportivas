import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import pg from 'pg';
import { createAuthFixtures } from '../tests/integration/auth-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

function localConnection() {
  let target;
  try { target = new URL(process.env.DIRECT_URL ?? ''); } catch {
    throw new Error('Configura DIRECT_URL para PostgreSQL local en .env.');
  }
  if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.hash ||
      !['5432', '5433'].includes(target.port || '5432')) {
    throw new Error('Las pruebas solo aceptan PostgreSQL loopback en puertos 5432/5433.');
  }
  for (const [key] of target.searchParams) {
    // schema se descarta: Prisma configura public y los modelos su propio schema.
    if (key !== 'schema') {
      throw new Error('DIRECT_URL contiene parámetros no permitidos para pruebas locales.');
    }
  }
  target.search = '';
  target.pathname = '/postgres';
  return target;
}

function command(commandArgs, env, showTestOutput = false) {
  return new Promise((resolve, reject) => {
    // No mostrar stdout/stderr de Prisma/Next: pueden incluir conexiones o SQL.
    const child = spawn(process.execPath, commandArgs, {
      cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const capture = (chunk) => { if (showTestOutput) output = (output + chunk.toString()).slice(-100_000); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', () => reject(new Error('No fue posible iniciar la herramienta local.')));
    child.once('exit', (code) => {
      if (showTestOutput) {
        let safe = output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[conexión omitida]');
        for (const key of ['DATABASE_URL', 'DIRECT_URL', 'NEXTAUTH_SECRET'])
          if (env[key]) safe = safe.replaceAll(env[key], '[secreto omitido]');
        safe = safe.replace(/\$argon2(?:id|i|d)\$[^\s"']+/g, '[hash omitido]');
        console.log(safe);
      }
      if (code === 0) resolve(); else reject(new Error('La herramienta local terminó con error.'));
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

let server;
let serverExited;
let databaseCreated = false;
let admin;
let cleaning;
let stage = 'preparación';
const databaseName = `pdgld48_test_${randomBytes(8).toString('hex')}`;
let childEnv;
let baseUrl;
const accountOptionMetrics = [];
let previewRoles = [];

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const child = server;
  if (process.platform === 'win32') {
    // Solo el árbol del proceso que inició este runner, nunca servidores ajenos.
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore',
      });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  } else child.kill('SIGTERM');
  await Promise.race([serverExited, delay(10_000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([serverExited, delay(5_000, undefined, { ref: false })]);
  }
  server = undefined;
}

async function startServer(retriedSecurityReminder = false) {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', new URL(baseUrl).port], {
    cwd: root, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (process.argv.includes('--benchmark-options')) {
    let pending = '';
    server.stdout.on('data', (chunk) => {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        const marker = 'ACCOUNT_OPTIONS_METRICS ';
        const index = line.indexOf(marker);
        if (index >= 0) accountOptionMetrics.push(JSON.parse(line.slice(index + marker.length)));
      }
    });
  } else server.stdout.resume();
  // Next 16.4 detiene el primer arranque de un agente ante un aviso de
  // seguridad y permite repetir el mismo comando. Cada reinicio de sesión
  // es un proceso nuevo: reconocer solo ese aviso, sin silenciar la política
  // ni tratar otros errores de arranque como un reintento exitoso.
  let securityReminder = false;
  let startupTail = '';
  const detectReminder = (chunk) => {
    startupTail = (startupTail + chunk.toString()).slice(-2048);
    if (/SecurityFatalError|This command stopped to show the upgrade recommendation/.test(startupTail)) securityReminder = true;
  };
  server.stdout.on('data', detectReminder);
  server.stderr.on('data', detectReminder);
  let failed = false;
  server.once('error', () => { failed = true; });
  serverExited = new Promise((resolve) => server.once('exit', resolve));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (failed || securityReminder || server.exitCode !== null || server.signalCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/auth/csrf`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok && typeof (await response.json()).csrfToken === 'string') return;
    } catch { /* Compilación/inicio aún en curso. */ }
    await delay(500);
  }
  if (securityReminder && !retriedSecurityReminder) {
    console.warn('Next.js mostró un aviso de seguridad; repitiendo una vez el arranque según su contrato. Revisar la actualización indicada.');
    await stopServer();
    return startServer(true);
  }
  throw new Error('Next.js no quedó disponible para las pruebas locales.');
}

async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    await stopServer();
    try {
      if (databaseCreated && admin) {
        // La base creada en esta ejecución es el único objetivo permitido.
        if (!/^pdgld48_test_[a-f0-9]{16}$/.test(databaseName)) throw new Error('Nombre temporal no válido.');
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName]);
        await admin.query(`DROP DATABASE "${databaseName}"`);
        databaseCreated = false;
        for (const role of previewRoles) {
          if (!['anon','authenticated','service_role','gestor_ligas_preview'].includes(role)) throw new Error('Rol temporal no válido.');
          await admin.query(`DROP ROLE "${role}"`);
        }
        previewRoles = [];
      }
    } finally {
      if (admin) await admin.end();
    }
  })();
  return cleaning;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanup().then(() => process.exit(signal === 'SIGINT' ? 130 : 143), () => {
      console.error('No se pudo completar la limpieza de la base temporal de pruebas.');
      process.exit(1);
    });
  });
}

try {
  if (process.argv.slice(2).length > 1 || process.argv.slice(2).some((arg) => !['--demo', '--affiliation-demo', '--authorization', '--benchmark-options', '--affiliations', '--team-enrollments', '--preview'].includes(arg)))
    throw new Error('Uso: node scripts/test-auth.mjs [--demo | --affiliation-demo | --authorization | --benchmark-options | --affiliations | --team-enrollments | --preview].');
  if (existsSync(fileURLToPath(new URL('../.next-auth-tests/dev/lock', import.meta.url)))) {
    throw new Error('Detén el servidor npm run dev antes de ejecutar estas pruebas.');
  }
  const target = localConnection();
  stage = 'conexión al PostgreSQL local';
  admin = new pg.Client({ connectionString: target.href, connectionTimeoutMillis: 8_000 });
  await admin.connect();
  stage = 'creación de base temporal';
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  target.pathname = `/${databaseName}`;
  const databaseUrl = target.href;
  baseUrl = `http://127.0.0.1:${await freePort()}`;
  childEnv = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
    NEXTAUTH_URL: baseUrl, NEXTAUTH_SECRET: randomBytes(48).toString('base64url'),
    NEXT_TELEMETRY_DISABLED: '1', AUTH_TEST_RUN: '1', AUTH_IDLE_TIMEOUT_MINUTES: '30',
    AUTH_MAX_FAILED_ATTEMPTS: '5', AUTH_LOCKOUT_MINUTES: '15', NODE_ENV: 'development' };
  delete childEnv.NEXTAUTH_URL_INTERNAL;
  // Las suites automatizadas nunca usan el Storage real configurado en .env.
  // La demostración manual conserva su configuración explícita.
  if (!process.argv.includes('--demo')) {
    childEnv.SUPABASE_URL = 'https://storage.example.test';
    childEnv.SUPABASE_STORAGE_SERVER_KEY = 'test-only-no-real-storage';
  }
  if (process.argv.includes('--benchmark-options')) {
    childEnv.ACCOUNT_OPTIONS_METRICS = '1';
    childEnv.NODE_OPTIONS = `${childEnv.NODE_OPTIONS ?? ''} --import=${new URL('../tests/integration/account-options-metrics.mjs', import.meta.url).href}`.trim();
  }
  stage = 'aplicación de migraciones en base temporal';
  console.log('PDGLD-48: preparando PostgreSQL temporal y servidor local.');
  await command(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], childEnv);
  if (process.argv.includes('--preview')) {
    stage = 'provisión del runtime limitado con RLS';
    const { preparePreviewRuntime } = await import('../tests/integration/preview-runtime.mjs');
    const fixture = new pg.Client({ connectionString: databaseUrl });
    await fixture.connect();
    const runtimePassword = randomBytes(32).toString('base64url');
    try { previewRoles = await preparePreviewRuntime(fixture, databaseName, runtimePassword); }
    finally { await fixture.end(); }
    const runtimeUrl = new URL(databaseUrl);
    runtimeUrl.username = 'gestor_ligas_preview';
    runtimeUrl.password = runtimePassword;
    childEnv.DATABASE_URL = runtimeUrl.href;
    delete childEnv.DATABASE_CA_CERT;
  }
  if (process.argv.includes('--affiliations') || process.argv.includes('--team-enrollments')) {
    stage = 'comparación de migraciones y esquema';
    await command(['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'], childEnv, true);
  }
  stage = 'inicio de Next.js';
  await startServer();
  if (process.argv.includes('--demo') || process.argv.includes('--affiliation-demo')) {
    stage = 'carga de datos sintéticos';
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const users = await createAuthFixtures(client);
      if (process.argv.includes('--affiliation-demo')) {
        const { prepareAffiliationReviewDemo } = await import('../tests/integration/affiliation-review-demo.mjs');
        const demo = await prepareAffiliationReviewDemo(client, databaseUrl, users);
        console.log(`PDGLD-60: contexto sintético preparado; solicitud ${demo.affiliationId}.`);
      }
    } finally { await client.end(); }
    console.log(`Demostración local: ${baseUrl}/login`);
    console.log('Usa los datos sintéticos documentados. Enter o Ctrl+C detiene el servidor y elimina esta base temporal.');
    await new Promise((resolve) => {
      const finish = () => {
        process.stdin.removeListener('data', finish);
        process.stdin.removeListener('end', finish);
        process.stdin.pause();
        resolve();
      };
      if (process.stdin.readableEnded) { resolve(); return; }
      process.stdin.once('data', finish);
      process.stdin.once('end', finish);
      process.stdin.resume();
    });
  } else if (process.argv.includes('--preview')) {
    stage = 'HTTP de afiliaciones, correcciones e inscripciones con rol limitado y RLS';
    const { runCatalogAccountIntegrationSuite } = await import('../tests/integration/catalog-accounts.test.mjs');
    await runCatalogAccountIntegrationSuite({ databaseUrl, baseUrl, onAdministrator: async actor => {
      await command(['--conditions=react-server', '--import', 'tsx', '--test', 'tests/integration/preview-authorization.test.ts'],
        { ...childEnv, PREVIEW_TEST_ACTOR: actor.id }, true);
    } });
    const { runAffiliationIntegrationSuite } = await import('../tests/integration/affiliations.test.mjs');
    await runAffiliationIntegrationSuite({ databaseUrl, baseUrl });
    const { runTeamEnrollmentIntegrationSuite } = await import('../tests/integration/team-enrollments.test.mjs');
    await runTeamEnrollmentIntegrationSuite({ databaseUrl, baseUrl, preview: true });
    const { verifyPreviewRuntime } = await import('../tests/integration/preview-runtime.mjs');
    const fixture = new pg.Client({ connectionString: databaseUrl });
    await fixture.connect();
    try { await verifyPreviewRuntime(fixture); } finally { await fixture.end(); }
  } else if (process.argv.includes('--team-enrollments')) {
    stage = 'pruebas HTTP de inscripción PDGLD-62/64';
    const { runTeamEnrollmentIntegrationSuite } = await import('../tests/integration/team-enrollments.test.mjs');
    await runTeamEnrollmentIntegrationSuite({ databaseUrl, baseUrl });
  } else if (process.argv.includes('--affiliations')) {
    stage = 'pruebas HTTP de afiliación PDGLD-57';
    const { runAffiliationIntegrationSuite } = await import('../tests/integration/affiliations.test.mjs');
    await runAffiliationIntegrationSuite({ databaseUrl, baseUrl });
  } else if (process.argv.includes('--benchmark-options')) {
    stage = 'medición local de opciones de cuentas';
    const { runAccountOptionsBenchmark } = await import('../tests/integration/account-options-benchmark.mjs');
    await runAccountOptionsBenchmark({ databaseUrl, baseUrl, metrics: accountOptionMetrics,
      restartServer: async () => { await stopServer(); await startServer(); } });
  } else {
    stage = 'pruebas HTTP';
    // Instalar RF22 antes de las suites aisladas que generan historial propio.
    const { runCatalogAccountIntegrationSuite } = await import('../tests/integration/catalog-accounts.test.mjs');
    await runCatalogAccountIntegrationSuite({ databaseUrl, baseUrl });
    const restartServer = async (idleMinutes = '30', loginPolicy = {}) => {
      await stopServer();
      childEnv.AUTH_IDLE_TIMEOUT_MINUTES = idleMinutes;
      childEnv.AUTH_MAX_FAILED_ATTEMPTS = loginPolicy.maxFailedAttempts ?? '5';
      childEnv.AUTH_LOCKOUT_MINUTES = loginPolicy.lockoutMinutes ?? '15';
      await startServer();
    };
    if (!process.argv.includes('--authorization')) {
      const { runAuthIntegrationSuite } = await import('../tests/integration/auth.test.mjs');
      await runAuthIntegrationSuite({ databaseUrl, baseUrl, restartServer });
      const { runSessionLifecycleSuite } = await import('../tests/integration/session-lifecycle.test.mjs');
      await runSessionLifecycleSuite({ databaseUrl, baseUrl, restartServer });
    }
    // Archivos independientes de Karol pueden incorporarse siguiendo este patrón.
    // Ejecutar secuencialmente: cada suite administra sus propios fixtures.
    const authorizationTests = readdirSync(new URL('../tests/integration/', import.meta.url))
      .filter((name) => /^authorization-.*\.test\.ts$/.test(name)).sort()
      .map((name) => `tests/integration/${name}`);
    if (authorizationTests.length)
      await command(['--conditions=react-server', '--import', 'tsx', '--test', '--test-concurrency=1', ...authorizationTests], childEnv, true);
    const { runPermissionAdministrationSuite } = await import('../tests/integration/permission-administration.test.mjs');
    await runPermissionAdministrationSuite({ databaseUrl, baseUrl });
    const { runAccountIntegrationSuite } = await import('../tests/integration/accounts.test.mjs');
    await runAccountIntegrationSuite({ databaseUrl, baseUrl });
    const { runAffiliationIntegrationSuite } = await import('../tests/integration/affiliations.test.mjs');
    await runAffiliationIntegrationSuite({ databaseUrl, baseUrl });
  }
} catch (error) {
  // Mensajes de librerías no se interpolan: pueden contener usuario/conexión/hash.
  const safeMessages = new Set([
    'Configura DIRECT_URL para PostgreSQL local en .env.',
    'Las pruebas solo aceptan PostgreSQL loopback en puertos 5432/5433.',
    'DIRECT_URL contiene parámetros no permitidos para pruebas locales.',
    'Detén el servidor npm run dev antes de ejecutar estas pruebas.',
    'Uso: node scripts/test-auth.mjs [--demo | --affiliation-demo | --authorization | --benchmark-options | --affiliations | --team-enrollments | --preview].',
    'Next.js no quedó disponible para las pruebas locales.',
  ]);
  console.error(safeMessages.has(error.message) ? error.message : `No se completó la fase: ${stage}.`);
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch {
    console.error('No se pudo completar la limpieza de la base temporal de pruebas.');
    process.exitCode = 1;
  }
}
