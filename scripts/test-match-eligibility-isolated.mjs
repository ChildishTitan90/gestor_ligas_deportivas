import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createAuthFixtures } from '../tests/integration/auth-fixtures.mjs';

// Un contenedor propio, sin volumen ni conexión heredada del entorno.
const nonce = randomBytes(8).toString('hex');
const container = `pdgld16-${nonce}`;
const database = `pdgld48_test_${nonce}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let created = false;
try {
  docker(['run', '-d', '--name', container, '--label', 'pdgld.ticket=PDGLD-16', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', `POSTGRES_DB=${database}`, '-p', '127.0.0.1::5432', 'postgres:15']);
  created = true;
  const port = docker(['port', container, '5432/tcp']).split(':').at(-1);
  const url = `postgresql://postgres:synthetic-local-only@127.0.0.1:${port}/${database}`;
  let ready = false;
  for (let n = 0; n < 40; n++) {
    try { docker(['exec', container, 'pg_isready', '-U', 'postgres']); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!ready) throw Error('PostgreSQL aislado no inició.');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    DATABASE_URL: url, DIRECT_URL: url, NEXTAUTH_URL: 'http://127.0.0.1:3099',
    NEXTAUTH_SECRET: randomBytes(48).toString('hex'), AUTH_TEST_RUN: '1', VMX_API_KEY: '',
    PLAYER_PARTICIPATIONS_ONLY: '1', MATCH_ELIGIBILITY_TEST_PORT: port,
    SUPABASE_URL: 'https://storage.example.test', SUPABASE_STORAGE_SERVER_KEY: 'synthetic-only' };
  const migrate = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env, encoding: 'utf8' });
  if (migrate.status !== 0) throw Error('Fallaron migraciones en el contenedor propio.');
  const fixture = new pg.Client({ connectionString: url });
  await fixture.connect();
  try { await createAuthFixtures(fixture); } finally { await fixture.end(); }
  const test = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--test', 'tests/integration/player-registrations.test.ts'], { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  console.log((test.stdout + test.stderr).replaceAll(url, '[conexión aislada]'));
  if (test.status !== 0) throw Error('Falló la regresión de elegibilidad.');
} finally {
  if (created) docker(['rm', '-f', container]);
}
