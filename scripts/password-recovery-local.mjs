import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import pg from 'pg';
import dotenv from 'dotenv';
import { childEnvironment } from './ci/delegate-isolated-runtime.mjs';
import { preparePreviewRuntime } from '../tests/integration/preview-runtime.mjs';
import { hashPassword } from '../src/server/auth/password.ts';
import { recoveryPolicy } from '../src/server/auth/password-recovery.ts';
import { resendConfiguration } from '../src/server/email/resend.ts';

const directory = resolve('.env-recovery-local');
const statePath = resolve(directory, 'state.json');
const secretPath = resolve(directory, 'secrets.env');
const origin = 'https://127.0.0.1:34432';
const base = childEnvironment(process.env);
const docker = (args, extra = {}) => {
  const result = spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    env: { ...base, ...extra }, encoding: 'utf8', timeout: 120000,
  });
  if (result.error || result.status !== 0) throw Error('Docker no confirmó la operación local. No se tocaron contenedores ajenos.');
  return result.stdout.trim();
};
const privateWrite = (path, value) => { writeFileSync(path, value, { mode: 0o600 }); chmodSync(path, 0o600); };
const readState = () => {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.match(state.container, /^[a-f0-9]{64}$/);
  assert.match(state.database, /^pdgld48_test_[a-f0-9]{16}$/);
  return state;
};
const assertOwned = state => {
  const actual = JSON.parse(docker(['inspect', state.container]))[0];
  assert.equal(actual.Config.Labels['pdgld32.owner'], state.ownerTag);
  assert.equal(actual.Name, `/${state.name}`);
  assert.deepEqual(actual.HostConfig.Binds ?? [], []);
  assert.ok(actual.Mounts.every(m => m.Type === 'tmpfs'));
  assert.deepEqual(actual.NetworkSettings.Ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: '55417' }]);
};
const policy = {
  PASSWORD_RECOVERY_ENABLED: 'true', PASSWORD_RECOVERY_TTL_MINUTES: '15', PASSWORD_RECOVERY_MAX_PER_HOUR: '3',
  PASSWORD_RECOVERY_RATE_WINDOW_SECONDS: '60', PASSWORD_RECOVERY_REQUESTS_PER_IP: '5', PASSWORD_RECOVERY_COMPLETIONS_PER_IP: '10',
  PASSWORD_RECOVERY_REQUESTS_GLOBAL: '50', PASSWORD_RECOVERY_COMPLETIONS_GLOBAL: '100', PASSWORD_RECOVERY_CLIENT_IP_MODE: 'local',
};
async function prepare() {
  if (existsSync(statePath)) throw Error('Ya hay un entorno registrado: usa status o start, sin reemplazarlo.');
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  if (!existsSync(secretPath)) privateWrite(secretPath, 'RESEND_API_KEY=\nACCOUNT_EMAIL_FROM=\nRECOVERY_TEST_EMAIL=\nRECOVERY_MAILBOX_CONTROLLED=false\n');
  const cert = (args) => {
    const result = spawnSync('openssl', args, { encoding: 'utf8', timeout: 30000 });
    if (result.error || result.status !== 0) throw Error('No se pudo generar el certificado local.');
  };
  cert(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '7', '-subj', '/CN=PDGLD-32 Local Test CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-keyout', resolve(directory, 'ca-key.pem'), '-out', resolve(directory, 'ca.pem')]);
  cert(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1',
    '-keyout', resolve(directory, 'localhost-key.pem'), '-out', resolve(directory, 'localhost.csr')]);
  privateWrite(resolve(directory, 'localhost.ext'), 'subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
  cert(['x509', '-req', '-in', resolve(directory, 'localhost.csr'), '-CA', resolve(directory, 'ca.pem'),
    '-CAkey', resolve(directory, 'ca-key.pem'), '-CAcreateserial', '-days', '7', '-extfile', resolve(directory, 'localhost.ext'), '-out', resolve(directory, 'localhost.pem')]);
  for (const file of ['ca-key.pem', 'localhost-key.pem']) chmodSync(resolve(directory, file), 0o600);
  const state = { name: `pdgld32-local-${randomUUID()}`, ownerTag: randomBytes(16).toString('hex'),
    database: `pdgld48_test_${randomBytes(8).toString('hex')}`, password: randomBytes(32).toString('base64url'),
    runtimePassword: randomBytes(32).toString('base64url'), authSecret: randomBytes(48).toString('base64url'),
    rateSecret: randomBytes(48).toString('base64url'), initialPassword: `Local!${randomBytes(24).toString('base64url')}9a`, userId: randomUUID() };
  let owner;
  try {
    state.container = docker(['create', '--name', state.name, '--label', `pdgld32.owner=${state.ownerTag}`,
      '--publish', '127.0.0.1:55417:5432', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev',
      '--env', 'POSTGRES_PASSWORD', '--env', `POSTGRES_DB=${state.database}`, 'postgres:17-bookworm'], { POSTGRES_PASSWORD: state.password });
    assert.match(state.container, /^[a-f0-9]{64}$/);
    privateWrite(statePath, JSON.stringify(state));
    docker(['start', state.container]); assertOwned(state);
    let ready = false;
    for (let n = 0; n < 80; n++) {
      try { docker(['exec', state.container, 'pg_isready', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert.ok(ready);
    const ownerUrl = `postgresql://postgres:${state.password}@127.0.0.1:55417/${state.database}`;
    const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...base, DIRECT_URL: ownerUrl }, encoding: 'utf8', timeout: 120000,
    });
    if (migration.status !== 0) throw Error('No se pudieron aplicar las migraciones en la base desechable.');
    owner = new pg.Client({ connectionString: ownerUrl }); await owner.connect();
    await preparePreviewRuntime(owner, state.database, state.runtimePassword, { isolatedPort: 55417 });
    const person = (await owner.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Prueba sintética','PDGLD-32') RETURNING id")).rows[0].id;
    await owner.query("INSERT INTO sports_management.users(id,person_id,username,email,password_hash,must_change_password) VALUES($1,$2,'pdgld32_local','pdgld32@example.invalid',$3,false)", [state.userId, person, await hashPassword(state.initialPassword)]);
    privateWrite(resolve(directory, 'account.txt'), `Usuario sintético: pdgld32_local\nContraseña inicial (solo prueba local): ${state.initialPassword}\n`);
    console.log(`Entorno aislado preparado en ${origin}. Correo apagado hasta start y configuración privada válida.`);
    console.log('Completa .env-recovery-local/secrets.env y confía manualmente en .env-recovery-local/ca.pem para HTTPS local.');
  } catch (error) {
    if (state.container) { docker(['rm', '--force', state.container]); }
    throw error;
  } finally { if (owner) await owner.end(); }
}
async function start(enabled = true) {
  const state = readState(); assertOwned(state);
  const privateEnv = dotenv.parse(readFileSync(secretPath));
  const email = privateEnv.RECOVERY_TEST_EMAIL?.trim().toLowerCase();
  if (enabled && (privateEnv.RECOVERY_MAILBOX_CONTROLLED !== 'true' || !email || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email) || /\.(invalid|test)$/.test(email)))
    throw Error('Completa el buzón controlado y su confirmación en el archivo privado; no escribas secretos en chat.');
  const env = { ...base, ...policy, NODE_ENV: 'development', AUTH_TEST_RUN: '1', NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: `postgresql://gestor_ligas_preview:${state.runtimePassword}@127.0.0.1:55417/${state.database}`,
    NEXTAUTH_URL: origin, NEXTAUTH_SECRET: state.authSecret, PASSWORD_RECOVERY_RATE_SECRET: state.rateSecret,
    ACCOUNT_EMAIL_ENABLED: enabled ? 'true' : 'false', PASSWORD_RECOVERY_ENABLED: enabled ? 'true' : 'false', ACCOUNT_EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: privateEnv.RESEND_API_KEY, ACCOUNT_EMAIL_FROM: privateEnv.ACCOUNT_EMAIL_FROM };
  if (enabled && (!resendConfiguration(env) || !recoveryPolicy(env))) throw Error('Falta configuración privada válida de Resend o de la política local.');
  // El propietario prepara solo el fixture; nunca se entrega su conexión al backend.
  const owner = new pg.Client({ connectionString: `postgresql://postgres:${state.password}@127.0.0.1:55417/${state.database}` });
  try { await owner.connect(); if (enabled) await owner.query('UPDATE sports_management.users SET email=$2,email_verified_at=now() WHERE id=$1 AND email<>$2', [state.userId, email]); }
  finally { await owner.end(); }
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '34432',
    '--experimental-https', '--experimental-https-key', resolve(directory, 'localhost-key.pem'), '--experimental-https-cert', resolve(directory, 'localhost.pem')],
  { env, stdio: ['ignore', 'pipe', 'pipe'] });
  // No volcar logs de peticiones, entorno, errores SQL ni mensajes privados.
  child.stdout.resume(); child.stderr.resume();
  console.log(`Servidor de pruebas iniciado en ${origin}; correo ${enabled ? 'real habilitado solo en este proceso' : 'deshabilitado por el modo serve' }.`);
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const code = await new Promise(resolve => child.once('exit', resolve));
  process.exitCode = code ?? 1;
}
async function status() {
  const state = readState(); assertOwned(state);
  const owner = new pg.Client({ connectionString: `postgresql://postgres:${state.password}@127.0.0.1:55417/${state.database}` });
  try {
    await owner.connect();
    const counts = (await owner.query(`SELECT (SELECT count(*)::int FROM public._prisma_migrations WHERE finished_at IS NOT NULL) migrations,
      (SELECT count(*)::int FROM sports_management.password_resets WHERE user_id=$1) requests,
      (SELECT count(*)::int FROM sports_management.sessions WHERE user_id=$1 AND revoked_at IS NULL) sessions,
      (SELECT count(*)::int FROM sports_management.authentication_events WHERE user_id=$1 AND action='PASSWORD_CHANGED') password_changes`, [state.userId])).rows[0];
    console.log(JSON.stringify({ environment: 'local-isolated', origin, ...counts }));
  } finally { await owner.end(); }
}
try {
  const command = process.argv[2];
  if (process.argv.length !== 3 || !['prepare', 'serve', 'start', 'status', 'stop'].includes(command)) throw Error('Usa prepare | serve | start | status | stop.');
  if (command === 'prepare') await prepare();
  if (command === 'start') await start();
  if (command === 'serve') await start(false);
  if (command === 'status') await status();
  if (command === 'stop') { const state = readState(); assertOwned(state); docker(['rm', '--force', state.container]); console.log('Contenedor propio eliminado. Retira también la confianza del certificado al terminar.'); }
} catch { console.error('No se completó la operación local. Revisa configuración privada, comando y disponibilidad de recursos; se omitieron detalles sensibles.'); process.exitCode = 1; }
