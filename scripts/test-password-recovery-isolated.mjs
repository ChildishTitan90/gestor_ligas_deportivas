import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { childEnvironment } from './ci/delegate-isolated-runtime.mjs';
import { preparePreviewRuntime } from '../tests/integration/preview-runtime.mjs';

// Ejecuta la suite existente sin usar compose, .env, bases heredadas ni correo real.
const environment = childEnvironment(process.env);
const docker = args => {
  const result = spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    env: environment, encoding: 'utf8', timeout: 120000,
  });
  if (result.error || result.status !== 0) throw Error('Falló Docker en la ejecución aislada de recuperación.');
  return result.stdout.trim();
};
let failed = false;
for (const major of [15, 17]) {
  const name = `pdgld32-recovery-${randomUUID()}`;
  const database = `pdgld48_test_${randomBytes(8).toString('hex')}`;
  const port = 55400 + major;
  let container, owner;
  const secret = randomBytes(32).toString('base64url');
  const ownerUrl = `postgresql://postgres:${secret}@127.0.0.1:${port}/${database}`;
  const runtimeSecret = randomBytes(32).toString('base64url');
  const runtimeUrl = `postgresql://gestor_ligas_preview:${runtimeSecret}@127.0.0.1:${port}/${database}`;
  const run = (args, env, show = false) => {
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
    if (show) {
      let output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      for (const value of [ownerUrl, runtimeUrl, secret, runtimeSecret]) output = output.replaceAll(value, '[privado]');
      console.log(output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[conexión omitida]'));
    }
    if (result.error || result.status !== 0) throw Error('Falló una comprobación de recuperación aislada.');
  };
  try {
    // El ID se conserva antes de arrancar: un puerto ocupado no deja recursos huérfanos.
    container = docker(['create', '--name', name, '--label', 'pdgld.ticket=PDGLD-32',
      '--publish', `127.0.0.1:${port}:5432`, '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev',
      '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', `POSTGRES_DB=${database}`, `postgres:${major}-bookworm`]);
    assert.match(container, /^[a-f0-9]{64}$/);
    docker(['start', container]);
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { docker(['exec', container, 'pg_isready', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert.ok(ready, 'PostgreSQL desechable no disponible.');
    const inspected = JSON.parse(docker(['inspect', container]))[0];
    assert.equal(inspected.Config.Labels['pdgld.ticket'], 'PDGLD-32');
    assert.deepEqual(inspected.HostConfig.Binds ?? [], []);
    assert.ok(inspected.Mounts.every(m => m.Type === 'tmpfs'));
    assert.deepEqual(inspected.NetworkSettings.Ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: String(port) }]);
    const base = { ...environment, DATABASE_URL: ownerUrl, DIRECT_URL: ownerUrl,
      ACCOUNT_EMAIL_ENABLED: 'false', PASSWORD_RECOVERY_ENABLED: 'false',
      NODE_ENV: 'development', AUTH_TEST_RUN: '1', NEXTAUTH_URL: 'http://127.0.0.1:3032' };
    run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], base);
    owner = new pg.Client({ connectionString: ownerUrl });
    await owner.connect();
    await preparePreviewRuntime(owner, database, runtimeSecret, { isolatedPort: port });
    run(['--conditions=react-server', '--import', 'tsx', '--test', 'tests/integration/password-recovery.test.ts'],
      { ...base, DATABASE_URL: runtimeUrl, DIRECT_URL: runtimeUrl, RECOVERY_TEST_ADMIN_URL: ownerUrl }, true);
    console.log(`PostgreSQL ${major}: recuperación aprobada con RLS, rol limitado y transporte simulado.`);
  } catch (error) {
    console.error(error instanceof assert.AssertionError ? 'Falló una garantía de aislamiento o de permisos.' : error.message);
    process.exitCode = 1; failed = true;
  } finally {
    if (owner) await owner.end();
    if (container) {
      docker(['rm', '--force', container]);
      console.log(`PostgreSQL ${major}: contenedor propio eliminado.`);
    }
  }
  if (failed) break;
}
