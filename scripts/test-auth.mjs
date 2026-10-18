import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

function command(commandArgs, env) {
  return new Promise((resolve, reject) => {
    // No mostrar stdout/stderr de Prisma/Next: pueden incluir conexiones o SQL.
    const child = spawn(process.execPath, commandArgs, {
      cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.resume();
    child.stderr.resume();
    child.once('error', () => reject(new Error('No fue posible iniciar la herramienta local.')));
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('La herramienta local terminó con error.')));
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

async function startServer() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', new URL(baseUrl).port], {
    cwd: root, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.resume();
  server.stderr.resume();
  let failed = false;
  server.once('error', () => { failed = true; });
  serverExited = new Promise((resolve) => server.once('exit', resolve));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (failed || server.exitCode !== null || server.signalCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/auth/csrf`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok && typeof (await response.json()).csrfToken === 'string') return;
    } catch { /* Compilación/inicio aún en curso. */ }
    await delay(500);
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
  if (process.argv.slice(2).some((arg) => arg !== '--demo')) throw new Error('Uso: node scripts/test-auth.mjs [--demo].');
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
    NEXT_TELEMETRY_DISABLED: '1', AUTH_TEST_RUN: '1', AUTH_IDLE_TIMEOUT_MINUTES: '30', NODE_ENV: 'development' };
  delete childEnv.NEXTAUTH_URL_INTERNAL;
  stage = 'aplicación de migraciones en base temporal';
  console.log('PDGLD-48: preparando PostgreSQL temporal y servidor local.');
  await command(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], childEnv);
  stage = 'inicio de Next.js';
  await startServer();
  if (process.argv.includes('--demo')) {
    stage = 'carga de datos sintéticos';
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try { await createAuthFixtures(client); } finally { await client.end(); }
    console.log(`Demostración local: ${baseUrl}/login`);
    console.log('Usa los datos sintéticos documentados. Enter o Ctrl+C detiene el servidor y elimina esta base temporal.');
    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
    });
  } else {
    stage = 'pruebas HTTP';
    const { runAuthIntegrationSuite } = await import('../tests/integration/auth.test.mjs');
    const restartServer = async (idleMinutes = '30') => {
      await stopServer();
      childEnv.AUTH_IDLE_TIMEOUT_MINUTES = idleMinutes;
      await startServer();
    };
    await runAuthIntegrationSuite({ databaseUrl, baseUrl, restartServer });
    const { runSessionLifecycleSuite } = await import('../tests/integration/session-lifecycle.test.mjs');
    await runSessionLifecycleSuite({ databaseUrl, baseUrl, restartServer });
    const { runAccountIntegrationSuite } = await import('../tests/integration/accounts.test.mjs');
    await runAccountIntegrationSuite({ databaseUrl, baseUrl });
  }
} catch (error) {
  // Mensajes de librerías no se interpolan: pueden contener usuario/conexión/hash.
  const safeMessages = new Set([
    'Configura DIRECT_URL para PostgreSQL local en .env.',
    'Las pruebas solo aceptan PostgreSQL loopback en puertos 5432/5433.',
    'DIRECT_URL contiene parámetros no permitidos para pruebas locales.',
    'Detén el servidor npm run dev antes de ejecutar estas pruebas.',
    'Uso: node scripts/test-auth.mjs [--demo].',
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
