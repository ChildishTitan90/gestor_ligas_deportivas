import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import pg from 'pg';
import { childEnvironment } from './ci/delegate-isolated-runtime.mjs';
import { PREVIEW_MARKER, PREVIEW_ROLE, provisionPreviewRuntime } from './preview/runtime-plan.mjs';

// Nunca lee .env ni acepta conexiones externas. Posee únicamente este contenedor sin volúmenes.
const major = process.argv.includes('--postgres=17') ? 17 : 15;
const nonce = randomBytes(8).toString('hex');
const container = `pdgld176-${nonce}`;
const database = `pdgld48_test_${nonce}`;
const privateRoot = mkdtempSync(join(tmpdir(), 'pdgld176-'));
const originalTypes = JSON.parse(readFileSync('tsconfig.json', 'utf8')).include;
let generatedTypes = [];
const manifest = join(privateRoot, 'fixture.json');
const base = { ...childEnvironment(process.env), NEXT_TELEMETRY_DISABLED: '1',
  AUTH_TEST_RUN: '1', BILLING_ISOLATED: '1', BILLING_MANIFEST: manifest,
  BILLING_EVIDENCE: resolve(`docs/validation/pdgld176/pg${major}`),
  NEXTAUTH_SECRET: randomBytes(48).toString('hex'), ACCOUNT_EMAIL_ENABLED: 'false', PASSWORD_RECOVERY_ENABLED: 'false',
  VMX_API_KEY: '', SUPABASE_URL: '', SUPABASE_STORAGE_SERVER_KEY: '', RESEND_API_KEY: '',
  ...(process.env.CHROME_BIN ? { CHROME_BIN: process.env.CHROME_BIN } : {}),
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let created = false, server, serverExit, diagnostic = '', db, adminUrl, runtimeUrl, fixture;
const safe = value => {
  for (const secret of [adminUrl, runtimeUrl, base.NEXTAUTH_SECRET, fixture?.password].filter(Boolean)) value = value.replaceAll(secret, '[privado]');
  return value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[base desechable]').replace(/\$argon2[^\s"']+/g, '[hash omitido]');
};
function docker(args) {
  const r = spawnSync('docker', args, { env: base, encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (r.status !== 0 || r.error) throw Error('Docker no confirmó la operación desechable PDGLD-176.');
  return r.stdout.trim();
}
function run(args, env, output = false) {
  const r = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (output || r.status !== 0) console.log(safe(`${r.stdout ?? ''}${r.stderr ?? ''}`).slice(-20000));
  assert.equal(r.status, 0, 'El runner propaga el fallo de la suite');
}
async function runSuite(env) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--test', '--test-concurrency=1', 'tests/integration/billing.test.mjs'],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const capture = stream => {
      let pending = '';
      stream.on('data', chunk => {
        pending += chunk.toString();
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) console.log(safe(line));
      });
      stream.on('end', () => { if (pending) console.log(safe(pending)); });
    };
    capture(child.stdout); capture(child.stderr);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error('La suite PDGLD-176 falló; el runner impide pasar CI.')));
  });
}
try {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  generatedTypes = [`.next-auth-tests-${port}/types/**/*.ts`, `.next-auth-tests-${port}/dev/types/**/*.ts`];
  base.NEXTAUTH_URL = origin;
  docker(['create', '--name', container, '--label', `pdgld176.owner=${nonce}`, '--env', 'POSTGRES_HOST_AUTH_METHOD=trust',
    '--env', `POSTGRES_DB=${database}`, '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev', `postgres:${major}`]);
  created = true; docker(['start', container]);
  const inspected = JSON.parse(docker(['inspect', container]))[0];
  assert.deepEqual(inspected.HostConfig.Binds ?? [], []);
  assert.ok(inspected.Mounts.every(m => m.Type === 'tmpfs'));
  const mapping = /^127\.0\.0\.1:(\d+)$/.exec(docker(['port', container, '5432/tcp'])); assert.ok(mapping);
  for (let n = 0; ; n++) {
    try { docker(['exec', container, 'pg_isready', '-U', 'postgres']); break; }
    catch { if (n === 79) throw Error('PostgreSQL desechable no disponible.'); await pause(250); }
  }
  adminUrl = `postgresql://postgres:synthetic@127.0.0.1:${mapping[1]}/${database}`;
  const env = { ...base, DATABASE_URL: adminUrl, DIRECT_URL: adminUrl };
  run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env);
  run(['--conditions=react-server', '--import', 'tsx', 'tests/integration/billing-fixture.ts'], env, true);
  fixture = JSON.parse(readFileSync(manifest, 'utf8'));
  db = new pg.Client({ connectionString: adminUrl }); await db.connect();
  await db.query(`COMMENT ON DATABASE "${database}" IS '${PREVIEW_MARKER}'`);
  await db.query(`DO $fixture$ DECLARE t record; BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='sports_management' LOOP
      EXECUTE format('ALTER TABLE sports_management.%I ENABLE ROW LEVEL SECURITY',t.tablename);
    END LOOP; END $fixture$`);
  await provisionPreviewRuntime(db);
  const runtimePassword = randomBytes(24).toString('hex');
  await db.query(`ALTER ROLE ${PREVIEW_ROLE} LOGIN PASSWORD '${runtimePassword}'`);
  const url = new URL(adminUrl); url.username = PREVIEW_ROLE; url.password = runtimePassword; runtimeUrl = url.href;
  const runtimeEnv = { ...env, DATABASE_URL: runtimeUrl, DIRECT_URL: runtimeUrl };
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
    { env: runtimeEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  server.stdout.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-24000); });
  server.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-24000); });
  serverExit = new Promise(resolve => server.once('exit', resolve));
  const start = Date.now();
  while (true) {
    if (server.exitCode !== null || Date.now() - start > 120000) throw Error('Next.js no estuvo disponible.');
    try { if ((await fetch(origin + '/api/auth/csrf', { signal: AbortSignal.timeout(5000) })).ok) break; } catch { /* Compilación inicial. */ }
    await pause(250);
  }
  console.log(`PDGLD-176 PostgreSQL ${major}: HTTP/NextAuth reales; backend con perfil limitado y RLS.`);
  // Admin se usa exclusivamente para inspección y fallos inyectados en la BD desechable.
  await runSuite({ ...runtimeEnv, BILLING_ADMIN_URL: adminUrl });
} catch (error) {
  console.error(safe(diagnostic).slice(-6000));
  console.error(safe(error.stack ?? String(error))); process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else server.kill('SIGTERM');
    await Promise.race([serverExit, pause(5000)]);
    if (server.exitCode === null) { server.kill('SIGKILL'); await serverExit; }
  }
  if (db) await db.end();
  // Next dev añade sus tipos. Retirar solo las entradas de ESTA ejecución;
  // conservar cualquier otra corrección concurrente del tsconfig.
  const config = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
  const retained = config.include.filter(value => !generatedTypes.includes(value) || originalTypes.includes(value));
  if (retained.length !== config.include.length) {
    config.include = retained; writeFileSync('tsconfig.json', JSON.stringify(config, null, 2) + '\n');
  }
  if (created) {
    const resource = JSON.parse(docker(['inspect', container]))[0];
    assert.equal(resource.Config.Labels['pdgld176.owner'], nonce);
    docker(['rm', '--force', resource.Id]);
  }
  // mkdtemp propio, comprobado bajo el temporal del SO antes de eliminarlo.
  assert.equal(resolve(privateRoot).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')), true);
  rmSync(privateRoot, { recursive: true, force: true });
}
