import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile,writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import pg from 'pg';
import { createAuthFixtures } from '../tests/integration/auth-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
const previewCompetitions = process.argv.includes('--preview-competitions');
const previewRuntime = process.argv.includes('--preview') || previewCompetitions;
const playerDemo = process.argv.includes('--player-demo');
const playerParticipations = process.argv.includes('--player-participations');

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
        safe=safe.replace(/https?:\/\/[^\s"']*\/storage\/v1\/[^\s"']+/gi,'[enlace privado omitido]');
        for (const key of ['DATABASE_URL', 'DIRECT_URL', 'NEXTAUTH_SECRET','SUPABASE_URL','SUPABASE_STORAGE_SERVER_KEY','VMX_API_KEY'])
          if (env[key]) safe = safe.replaceAll(env[key], '[secreto omitido]');
        safe = safe.replace(/\$argon2(?:id|i|d)\$[^\s"']+/g, '[hash omitido]');
        console.log(safe);
      }
      if (code === 0) resolve(); else reject(new Error('La herramienta local terminó con error.'));
    });
  });
}

async function freePort(preferredPort=0) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(preferredPort, '127.0.0.1', resolve);
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
let manualFixturePrepared=false;
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
        if(playerDemo && manualFixturePrepared){
          const recovery=new pg.Client({connectionString:childEnv.DIRECT_URL,connectionTimeoutMillis:5000});
          try{
            await recovery.connect();
            const files=await recovery.query('SELECT id,storage_key,mime_type,size_bytes,sha256 FROM sports_management.files ORDER BY id');
            const events=await recovery.query(`SELECT id,action,entity_id,new_data FROM sports_management.audit_logs
              WHERE action LIKE 'PLAYER_DOCUMENT_%' OR action LIKE 'PLAYER_INE_%' ORDER BY occurred_at,id`);
            const saved=JSON.parse(await readFile(childEnv.PLAYER_DEMO_SESSION_FILE,'utf8'));
            await writeFile(childEnv.PLAYER_DEMO_SESSION_FILE,JSON.stringify({...saved,closedAt:new Date().toISOString(),files:files.rows,operations:events.rows},null,2),{mode:0o600});
          }catch{console.error('No se pudo exportar el manifiesto privado; se conserva la BD temporal para recuperación.');throw new Error('Exportación manual incompleta.');}
          finally{await recovery.end();}
        }
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
  if (process.argv.slice(2).length > 1 || process.argv.slice(2).some((arg) => !['--demo', '--affiliation-demo', '--player-demo', '--player-participations', '--authorization', '--benchmark-options', '--affiliations', '--team-enrollments', '--preview', '--preview-competitions', '--competitions', '--players', '--documents-real', '--club-maintenance', '--match-transitions'].includes(arg)))
    throw new Error('Uso: node scripts/test-auth.mjs [--demo | --affiliation-demo | --authorization | --benchmark-options | --affiliations | --team-enrollments | --preview | --preview-competitions | --competitions | --players | --documents-real | --club-maintenance].');
  if (existsSync(fileURLToPath(new URL(playerDemo?'../.next-player-manual/dev/lock':'../.next-auth-tests/dev/lock', import.meta.url)))) {
    throw new Error('Detén el servidor npm run dev antes de ejecutar estas pruebas.');
  }
  const target = localConnection();
  let documentStorageTest;
  if(process.argv.includes('--documents-real')){
    const {readPlayerDocumentTestConfiguration}=await import('./verification/player-document-test-config.mjs');
    documentStorageTest=await readPlayerDocumentTestConfiguration();
  }
  stage = 'conexión al PostgreSQL local';
  admin = new pg.Client({ connectionString: target.href, connectionTimeoutMillis: 8_000 });
  await admin.connect();
  stage = 'creación de base temporal';
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  target.pathname = `/${databaseName}`;
  const databaseUrl = target.href;
  const manualPort=process.env.PLAYER_DEMO_PORT ?? '3001';
  if(playerDemo && !['3000','3001'].includes(manualPort))throw new Error('Puerto manual inválido.');
  stage='puerto local disponible (detén tu dev habitual si ocupa el puerto elegido)';
  baseUrl = `http://127.0.0.1:${await freePort(playerDemo?Number(manualPort):0)}`;
  childEnv = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl,
    NEXTAUTH_URL: baseUrl, NEXTAUTH_SECRET: randomBytes(48).toString('base64url'),
    NEXT_TELEMETRY_DISABLED: '1', AUTH_TEST_RUN: '1', AUTH_IDLE_TIMEOUT_MINUTES: '30',
    AUTH_MAX_FAILED_ATTEMPTS: '5', AUTH_LOCKOUT_MINUTES: '15', NODE_ENV: 'development' };
  delete childEnv.NEXTAUTH_URL_INTERNAL;
  delete childEnv.PLAYER_DOCUMENT_STORAGE_REAL_TEST;
  delete childEnv.PLAYER_DOCUMENT_TEST_POLICY;
  delete childEnv.PLAYER_DOCUMENT_HTTP_BASE_URL;
  delete childEnv.PLAYER_MANUAL_SCENARIOS;
  delete childEnv.PLAYER_DEMO_ORIGIN;
  delete childEnv.PLAYER_PARTICIPATIONS_ONLY;
  delete childEnv.PLAYER_PARTICIPATIONS_HTTP_BASE_URL;
  if(playerParticipations){childEnv.PLAYER_PARTICIPATIONS_ONLY='1';childEnv.PLAYER_PARTICIPATIONS_HTTP_BASE_URL=baseUrl;
    if(process.env.PLAYER_PARTICIPATIONS_KEEP_SERVER==='1')childEnv.PLAYER_PARTICIPATIONS_MANIFEST=join(tmpdir(),`pdgld-participations-${randomBytes(8).toString('hex')}.json`);
  }
  // Las suites automatizadas nunca usan el Storage real configurado en .env.
  // La demostración manual conserva su configuración explícita.
  if (!process.argv.includes('--demo')) {
    // Prohibido consumir Verificamex durante las suites automatizadas, aun con .env configurado.
    // Vacío explícito evita que Next vuelva a cargar la clave desde .env.local.
    childEnv.VMX_API_KEY='';
    childEnv.SUPABASE_URL = 'https://storage.example.test';
    childEnv.SUPABASE_STORAGE_SERVER_KEY = 'test-only-no-real-storage';
  }
  if(playerDemo){
    stage='configuración del entorno manual aislado';
    delete childEnv.AUTH_TEST_RUN;
    childEnv.PLAYER_MANUAL_SCENARIOS='1';
    childEnv.PLAYER_DEMO_LOCAL_URL=baseUrl;
    childEnv.PLAYER_DEMO_SESSION_FILE=join(tmpdir(),`pdgld-player-manual-${randomBytes(8).toString('hex')}.json`);
    if(process.env.PLAYER_DEMO_ORIGIN){
      const origin=new URL(process.env.PLAYER_DEMO_ORIGIN);
      const forwardedPort=origin.hostname.match(/-(3000|3001)\./)?.[1];
      if(origin.protocol!=='https:' || origin.username || origin.password || origin.pathname!=='/' || origin.hash || origin.search || (forwardedPort && forwardedPort!==manualPort))throw new Error('Origen manual inválido: el enlace HTTPS debe coincidir con el puerto elegido.');
      childEnv.NEXTAUTH_URL=origin.origin;
      childEnv.PLAYER_DEMO_ORIGIN=origin.origin;
    }
    if(process.env.PLAYER_DEMO_SMOKE!=='1'){
      const {readPlayerDocumentTestConfiguration}=await import('./verification/player-document-test-config.mjs');
      Object.assign(childEnv,await readPlayerDocumentTestConfiguration());
      const local=dotenv.parse(await readFile(new URL('../.env.local',import.meta.url),'utf8'));
      if(!local.VMX_API_KEY?.trim())throw new Error('Falta VMX_API_KEY para prueba humana.');
      childEnv.VMX_API_KEY=local.VMX_API_KEY;
    }
  }
  if(documentStorageTest){
    Object.assign(childEnv,documentStorageTest);
    childEnv.PLAYER_DOCUMENT_STORAGE_REAL_TEST='1';
    childEnv.PLAYER_DOCUMENT_HTTP_BASE_URL=baseUrl;
    childEnv.PLAYER_DOCUMENT_TEST_POLICY=JSON.stringify({referenceDate:'2026-01-01',opensAt:new Date(Date.now()-60000).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString()});
    childEnv.PLAYER_DOCUMENT_TEST_MANIFEST=fileURLToPath(new URL(`player-documents-${databaseName}.json`,new URL(`file:///${process.env.TEMP.replaceAll('\\','/')}/`)));
    console.log(`Manifiesto privado de objetos sintéticos: ${childEnv.PLAYER_DOCUMENT_TEST_MANIFEST}`);
  }
  if (process.argv.includes('--benchmark-options')) {
    childEnv.ACCOUNT_OPTIONS_METRICS = '1';
    childEnv.NODE_OPTIONS = `${childEnv.NODE_OPTIONS ?? ''} --import=${new URL('../tests/integration/account-options-metrics.mjs', import.meta.url).href}`.trim();
  }
  stage = 'aplicación de migraciones en base temporal';
  console.log(process.argv.includes('--players')
    ? 'PDGLD-97: preparando PostgreSQL temporal, sin servidor HTTP ni proveedor externo.'
    : 'PDGLD-48: preparando PostgreSQL temporal y servidor local.');
  await command(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], childEnv);
  if (previewRuntime) {
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
    // La aplicación recibe únicamente la conexión limitada, incluso si algún
    // consumidor futuro consulta DIRECT_URL por error. Las migraciones ya terminaron.
    childEnv.DIRECT_URL = runtimeUrl.href;
    delete childEnv.DATABASE_CA_CERT;
  }
  if (process.argv.includes('--affiliations') || process.argv.includes('--team-enrollments') || process.argv.includes('--competitions') || process.argv.includes('--players') || playerParticipations || documentStorageTest) {
    stage = 'comparación de migraciones y esquema';
    await command(['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'], childEnv, true);
  }
  stage = 'inicio de Next.js';
  if(playerDemo){
    stage='fixtures de prueba manual';
    await command(['--conditions=react-server','--import','tsx','scripts/verification/prepare-player-manual.mts'],childEnv,true);
    manualFixturePrepared=true;
    stage='inicio de Next.js manual';
  }
  if (!process.argv.includes('--players')) await startServer();
  if(playerDemo){
    console.log(`Prueba manual aislada: ${childEnv.NEXTAUTH_URL}/login`);
    console.log(`Cuentas y contextos en archivo privado: ${childEnv.PLAYER_DEMO_SESSION_FILE}`);
    console.log('CURP e INE: solo una acción humana explícita consulta al proveedor. No hay consultas automáticas.');
    console.log('Los archivos de Storage no se eliminan al cerrar. Enter o Ctrl+C cierra únicamente este servidor y su BD temporal.');
    if(process.env.PLAYER_DEMO_SMOKE==='1'){
      stage='comprobación HTTP sintética de inicio, acceso y escenarios';
      await command(['--conditions=react-server','--import','tsx','scripts/verification/player-manual-smoke.mts'],{...childEnv,PLAYER_DEMO_LOCAL_URL:baseUrl},true);
    }else await new Promise(resolve=>{
      const finish=()=>{process.stdin.removeListener('data',finish);process.stdin.removeListener('end',finish);process.stdin.pause();resolve();};
      if(process.stdin.readableEnded){resolve();return;}
      process.stdin.once('data',finish);process.stdin.once('end',finish);process.stdin.resume();
    });
  } else if (process.argv.includes('--players') || playerParticipations || documentStorageTest) {
    stage = 'integridad y permisos del servicio de jugadores en PostgreSQL temporal';
    await command(['--conditions=react-server', '--import', 'tsx', '--test',
      'tests/integration/player-registrations.test.ts'], childEnv, true);
    if(playerParticipations && childEnv.PLAYER_PARTICIPATIONS_MANIFEST){
      console.log(`Entrega 1: servidor de revisión sintético ${baseUrl}; accesos e identificadores en archivo privado ${childEnv.PLAYER_PARTICIPATIONS_MANIFEST}`);
      console.log('Sin proveedores reales. Enter o Ctrl+C detiene el servidor y elimina solo esta base temporal.');
      await new Promise(resolve=>{const finish=()=>{process.stdin.removeListener('data',finish);process.stdin.removeListener('end',finish);process.stdin.pause();resolve();};process.stdin.once('data',finish);process.stdin.once('end',finish);process.stdin.resume();});
    }
    if(documentStorageTest && process.env.PLAYER_DOCUMENT_KEEP_SERVER==='1'){
      console.log('Servidor aislado disponible para revisión. Los accesos sintéticos están en el archivo privado .session.json junto al manifiesto. Enter o Ctrl+C cierra y elimina solo la BD temporal.');
      await new Promise(resolve=>{process.stdin.once('data',resolve);process.stdin.once('end',resolve);process.stdin.resume();});
    }
  } else if (process.argv.includes('--demo') || process.argv.includes('--affiliation-demo')) {
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
    const { verifyPreviewPrismaAccountCreation } = await import('../tests/integration/preview-prisma-account.mjs');
    await verifyPreviewPrismaAccountCreation({ databaseUrl: childEnv.DATABASE_URL });
    const { runCatalogAccountIntegrationSuite } = await import('../tests/integration/catalog-accounts.test.mjs');
    await runCatalogAccountIntegrationSuite({ databaseUrl, baseUrl, onAdministrator: async actor => {
      await command(['--conditions=react-server', '--import', 'tsx', '--test', 'tests/integration/preview-authorization.test.ts'],
        { ...childEnv, PREVIEW_TEST_ACTOR: actor.id }, true);
    } });
    const { runAffiliationIntegrationSuite } = await import('../tests/integration/affiliations.test.mjs');
    await runAffiliationIntegrationSuite({ databaseUrl, baseUrl });
    const { runTeamEnrollmentIntegrationSuite } = await import('../tests/integration/team-enrollments.test.mjs');
    await runTeamEnrollmentIntegrationSuite({ databaseUrl, baseUrl, preview: true });
    const { runSeasonIntegrationSuite } = await import('../tests/integration/seasons.test.mjs');
    await runSeasonIntegrationSuite({ databaseUrl, baseUrl, preview: true });
    const { verifyPreviewRuntime } = await import('../tests/integration/preview-runtime.mjs');
    const fixture = new pg.Client({ connectionString: databaseUrl });
    await fixture.connect();
    try { await verifyPreviewRuntime(fixture); } finally { await fixture.end(); }
  } else if (process.argv.includes('--competitions') || previewCompetitions) {
    stage = previewCompetitions ? 'competencias por HTTP con gestor_ligas_preview y RLS' : 'configuración de temporadas';
    const { runSeasonIntegrationSuite } = await import('../tests/integration/seasons.test.mjs');
    await runSeasonIntegrationSuite({ databaseUrl, baseUrl });
    if (previewCompetitions) {
      stage = 'mantenimiento repetible y restricciones del rol tras competencias';
      const { verifyPreviewMaintenance } = await import('../tests/integration/preview-runtime.mjs');
      const { test } = await import('node:test');
      const owner = new pg.Client({ connectionString: databaseUrl });
      await owner.connect();
      try {
        // El pool de Next que atendió los endpoints conserva conexiones del rol
        // limitado; los únicos clientes propietarios son los fixtures del harness.
        await test('Preview: pool de Next limitado y mantenimiento repetible después de competencias', async () => {
          const active = await owner.query('SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND usename=$2', [databaseName, 'gestor_ligas_preview']);
          if (!active.rows.length) throw new Error('No se comprobó el pool limitado de Next.');
          await verifyPreviewMaintenance(owner);
        });
      } finally { await owner.end(); }
      const runtime = new pg.Client({ connectionString: childEnv.DATABASE_URL });
      await runtime.connect();
      try {
        const { rows: [identity] } = await runtime.query('SELECT current_user AS actor, session_user AS login');
        if (identity.actor !== 'gestor_ligas_preview' || identity.login !== identity.actor) throw new Error('Identidad SQL de Preview inesperada.');
      } finally { await runtime.end(); }
    }
  } else if (process.argv.includes('--match-transitions')) {
    stage = 'transiciones de partidos con sesión y navegador';
    await command(['--conditions=react-server', '--import', 'tsx', '--test', 'tests/integration/match-transitions.test.ts'], { ...childEnv, PDGLD132_TEST_DATABASE_URL: databaseUrl, PDGLD132_HTTP_TEST: '1' }, true);
  } else if (process.argv.includes('--club-maintenance')) {
    stage = 'mantenimiento de clubes y equipos PDGLD-121';
    await command(['--conditions=react-server', '--import', 'tsx', '--test', 'tests/integration/authorization-club-maintenance.test.ts'], childEnv, true);
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
    'Uso: node scripts/test-auth.mjs [--demo | --affiliation-demo | --authorization | --benchmark-options | --affiliations | --team-enrollments | --preview | --preview-competitions | --competitions | --players | --documents-real].',
    'Next.js no quedó disponible para las pruebas locales.',
  ]);
  console.error(safeMessages.has(error.message) ? error.message : `No se completó la fase: ${stage}.`);
  if (previewRuntime && [
    'Destino de provisión de Preview no autorizado', 'No se reconoce la instalación de pruebas',
    'La provisión exige RLS activo en todas las tablas', 'El rol de Preview debe ser limitado y sin membresías',
    'Preview no debe ser propietario ni tener CREATE', 'Preview tiene acceso al ledger de Prisma',
  ].includes(error.message)) console.error(`Fixture de Preview: ${error.message}.`);
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch {
    console.error('No se pudo completar la limpieza de la base temporal de pruebas.');
    process.exitCode = 1;
  }
}
