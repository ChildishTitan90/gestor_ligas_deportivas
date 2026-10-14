import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL('..', import.meta.url));
const databaseName = 'gestor_ligas_ci';
let containerId;
let password;

function redact(output) {
  let safe = String(output ?? '').replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[URL omitida]');
  if (password) safe = safe.replaceAll(password, '[secreto omitido]');
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    try {
      const credential = decodeURIComponent(new URL(process.env[key]).password);
      if (credential) safe = safe.replaceAll(credential, '[secreto omitido]');
    } catch { /* No se utiliza ni se muestra una URL inválida. */ }
  }
  return safe;
}

function run(command, args, env = process.env, timeout = 120_000) {
  const result = spawnSync(command, args, {
    cwd: directory, env, encoding: 'utf8', timeout, windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const details = redact(`${result.stdout ?? ''}${result.stderr ?? ''}`).trim();
    throw new Error(`Falló ${command === process.execPath ? 'el comando Node.js' : command}${details ? `:\n${details}` : '.'}`);
  }
  return result.stdout.trim();
}

function ciUrl(value) {
  let target;
  try { target = new URL(value); } catch { throw new Error('Las pruebas requieren URL PostgreSQL válidas.'); }
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
      || !['localhost', '127.0.0.1'].includes(target.hostname)
      || !['5432', '5433'].includes(target.port)
      || target.pathname !== `/${databaseName}` || target.hash) {
    throw new Error('--existing solo acepta gestor_ligas_ci en localhost/127.0.0.1:5432/5433.');
  }
  for (const [key, value] of target.searchParams) {
    if (key !== 'schema' || value !== 'public') {
      throw new Error('La URL de pruebas solo permite schema=public; no permite cambiar el destino por parámetros.');
    }
  }
  return target;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== '--existing')) {
    throw new Error('Uso: npm run test:seed [-- --existing].');
  }
  let env;
  if (args[0] === '--existing') {
    if (process.env.CI !== 'true') throw new Error('--existing requiere CI=true y una base temporal de CI.');
    const direct = ciUrl(process.env.DIRECT_URL);
    const application = ciUrl(process.env.DATABASE_URL);
    // También compara credenciales y parámetros para que ambas herramientas usen la misma base.
    direct.protocol = application.protocol = 'postgresql:';
    direct.hostname = application.hostname = '127.0.0.1';
    direct.searchParams.delete('schema');
    application.searchParams.delete('schema');
    if (direct.href !== application.href) throw new Error('DIRECT_URL y DATABASE_URL deben apuntar a la misma base temporal.');
    env = { ...process.env, SEED_TEST_DATABASE: databaseName };
  } else {
    password = randomBytes(32).toString('hex');
    const containerName = `pdgld47-seed-${randomUUID()}`;
    const dockerEnv = { ...process.env, POSTGRES_PASSWORD: password };
    containerId = run('docker', [
      'run', '--rm', '--detach', '--name', containerName,
      '--publish', '127.0.0.1::5432',
      '--tmpfs', '/var/lib/postgresql/data:rw',
      '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=postgres',
      '--env', `POSTGRES_DB=${databaseName}`, 'postgres:15',
    ], dockerEnv);
    if (!/^[a-f0-9]{64}$/.test(containerId)) {
      containerId = undefined;
      throw new Error('Docker no devolvió un identificador de contenedor válido.');
    }
    const endpoint = run('docker', ['port', containerId, '5432/tcp']);
    const match = /^127\.0\.0\.1:(\d+)$/.exec(endpoint);
    if (!match) throw new Error('La base temporal debe publicar solo un puerto loopback.');
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = spawnSync('docker', ['exec', containerId, 'pg_isready', '-U', 'postgres', '-d', databaseName], {
        encoding: 'utf8', windowsHide: true, timeout: 5_000,
      });
      if (result.status === 0) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error('PostgreSQL temporal no estuvo listo dentro del plazo de prueba.');
    const url = `postgresql://postgres:${password}@127.0.0.1:${match[1]}/${databaseName}?schema=public`;
    env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, SEED_TEST_DATABASE: databaseName };
    console.log('PostgreSQL 15 temporal listo; no se montaron volúmenes.');
  }
  env.PATH = `${join(directory, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
  const prismaCli = require.resolve('prisma/build/index.js');
  run(process.execPath, [prismaCli, 'migrate', 'deploy'], env);
  run(process.execPath, [prismaCli, 'generate'], env);
  console.log('Migraciones aplicadas y cliente Prisma generado en la base temporal.');
  const output = run(process.execPath, [require.resolve('tsx/cli'), '--test', 'tests/integration/seed.test.ts'], env, 240_000);
  console.log(redact(output));
}

try {
  await main();
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : 'Falló la comprobación del seed.'));
  process.exitCode = 1;
} finally {
  if (containerId) {
    // --rm elimina únicamente este contenedor, creado por esta ejecución; nunca toca volúmenes del proyecto.
    const stopped = spawnSync('docker', ['stop', containerId], {
      encoding: 'utf8', windowsHide: true, timeout: 30_000,
    });
    if (stopped.status !== 0) {
      console.error('No se pudo detener el contenedor temporal creado por test:seed.');
      process.exitCode = 1;
    } else {
      console.log('Contenedor temporal de pruebas detenido.');
    }
  }
}
