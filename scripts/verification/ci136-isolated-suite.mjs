import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ci136CopySources, ci136PortPlan, assertCI136Target, CI136_PORT } from './ci136-port-plan.mjs';
import { childEnvironment, ISOLATED_TEMP_ROOT } from '../ci/delegate-isolated-runtime.mjs';
import { createAccountAppCopy, configureAccountTurbopack } from './account-app-copy.mjs';
import { independentInstallPlan, installIndependentDependencies, runIsolatedCommand } from './account-independent-dependencies.mjs';
import { privateStartupCapture } from './account-startup-probe.mjs';

export async function assertCI136PortFree() {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: CI136_PORT, exclusive: true }, resolve);
    });
  } catch { throw new Error('CI136_PORT_NOT_FREE: no se conecta ni se detiene el servicio existente.'); }
  finally { if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

export async function cleanupCI136Applications(root, major) {
  assert.equal(root, ci136PortPlan(root.slice(`${ISOLATED_TEMP_ROOT}/pdgld106-`.length)).root);
  assert.ok([15, 17].includes(major));
  assert.equal((await lstat(root)).isSymbolicLink(), false);
  // Inspect only; never kill a process by pattern. Keep profiles if anything lives.
  const processes = await new Promise((resolve, reject) => execFile('ps', ['-axo', 'command='],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
    (error, stdout) => error ? reject(new Error('CI136_PROCESS_CLEANUP_UNVERIFIED')) : resolve(stdout)));
  assert.equal(processes.split('\n').some(line => line.includes(`${root}/app-pg${major}`)
    || line.includes(`${root}/npm-work-pg${major}`) || line.includes(`${root}/chrome-pg${major}`)), false,
  'CI136_OWN_PROCESSES_REMAIN: se conservan perfiles para diagnóstico.');
  for (const directory of [`app-pg${major}`, `npm-work-pg${major}`, `chrome-pg${major}`])
    await rm(`${root}/${directory}`, { recursive: true, force: true });
}

// Never persist arbitrary test output, assertion values, URLs, cookies or tokens.
export function ci136SafeCapture(capture) {
  const tails = new Map();
  return { output(stream, chunk) {
    const text = (tails.get(stream) ?? '') + String(chunk);
    const lines = text.split('\n');
    tails.set(stream, lines.pop().slice(-2048));
    for (const line of lines) {
      const count = /^(?:ℹ |# )?(tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/.exec(line.trim());
      if (count) capture.output(stream, JSON.stringify({ metric: count[1], count: Number(count[2]) }) + '\n');
    }
  } };
}

// Injectable ordering is also tested without services. Never run clubs after seed failure.
export async function executeCI136Checks(io) {
  await io.verify();
  await io.seed();
  await io.record('seed', true);
  await io.verify();
  await io.clubs();
  await io.record('clubs', true);
  await io.verify();
  await io.checkDatabaseCleanup();
}

// Library of the existing supervisor, not a second executable runner.
export async function runCI136Version(config, plan, docker, signal) {
  signal = AbortSignal.any([AbortSignal.timeout(1200000), ...(signal ? [signal] : [])]);
  const item = plan.versions.find(item => item.major === config.major);
  assert.ok(item); assert.equal(config.runId, plan.runId);
  assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, CI136_PORT);
  const ids = { container: config.containerId, network: config.networkId };
  const runtime = { directory: plan.root, major: item.major, app: `${plan.root}/app-pg${item.major}` };
  const evidence = `${plan.root}/evidence-pg${item.major}`;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let stage = 'identity';
  const verify = async () => {
    stage = 'identity';
    signal?.throwIfAborted();
    const [container, network] = await Promise.all([
      docker.inspect('container', ids.container), docker.inspect('network', ids.network),
    ]);
    assertCI136Target(container, network, plan, item, ids);
    return { container, network, plan, item, ids };
  };
  const result = { postgres: item.major, seed: 'NOT_STARTED', clubs: 'NOT_STARTED' };
  await mkdir(evidence, { mode: 0o700 });
  const record = () => writeFile(`${evidence}/result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
  try {
    await verify();
    stage = 'copy';
    await createAccountAppCopy(root, runtime.app, { dependencies: 'independent', verification: true });
    // Explicit CLI config only; never copy .env or compose.yml.
    await writeFile(`${runtime.app}/prisma.config.ts`, await readFile(`${root}/prisma.config.ts`), { flag: 'wx', mode: 0o600 });
    stage = 'installation';
    const installation = await privateStartupCapture(`${evidence}/installation`, 'npm');
    try { result.installation = await installIndependentDependencies(runtime, installation, signal); }
    finally { installation.close(); }
    await configureAccountTurbopack(runtime.app, root, { dependencies: 'independent' });
    const proof = await verify();
    stage = 'adapt-copy';
    const adapted = ci136CopySources({ auth: await readFile(`${runtime.app}/scripts/test-auth.mjs`, 'utf8'),
      seed: await readFile(`${runtime.app}/scripts/test-seed.mjs`, 'utf8') }, proof);
    await writeFile(`${runtime.app}/scripts/test-auth.mjs`, adapted.auth);
    await writeFile(`${runtime.app}/scripts/test-seed.mjs`, adapted.seed);
    stage = 'version';
    const version = (await docker.docker(['exec', ids.container, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', 'SHOW server_version_num'], {}, signal)).trim();
    assert.match(version, /^\d{6}$/);
    assert.equal(Math.floor(Number(version) / 10000), item.major);
    result.serverVersionNum = Number(version);
    await verify();
    stage = 'seed-database';
    await docker.docker(['exec', ids.container, 'createdb', '-U', 'postgres', 'gestor_ligas_ci'], {}, signal);
    const url = new URL(`postgresql://postgres@127.0.0.1:${CI136_PORT}/gestor_ligas_ci?schema=public`);
    url.password = config.password;
    const env = { ...childEnvironment(process.env), CI: 'true', NODE_ENV: 'development',
      TMPDIR: `${independentInstallPlan(runtime).work}/tmp`, NEXT_TELEMETRY_DISABLED: '1',
      DATABASE_URL: url.href, DIRECT_URL: url.href,
      CHROME_BIN: process.env.CHROME_BIN ?? (process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome') };
    const run = async (name, command, args) => {
      stage = name;
      const capture = await privateStartupCapture(`${evidence}/${name}`, 'next');
      try {
        await runIsolatedCommand({ command, args, cwd: runtime.app, timeoutMs: 600000,
          terminationGraceMs: 15000, failureCode: `CI136_${name.toUpperCase()}` }, env, ci136SafeCapture(capture), signal);
      } finally { capture.close(); }
    };
    await executeCI136Checks({ verify,
      seed: () => run('seed', 'npm', ['run', 'test:seed', '--', '--existing']),
      clubs: () => run('clubs', process.execPath, ['scripts/test-auth.mjs', '--club-maintenance']),
      record: async name => { result[name] = 'PASSED'; await record(); },
      checkDatabaseCleanup: async () => {
        stage = 'database-cleanup';
        const names = (await docker.docker(['exec', ids.container, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
          "SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1') ORDER BY datname"], {}, signal)).trim();
        assert.equal(names, 'gestor_ligas_ci', 'Quedaron bases de clubes sin retirar.');
        await docker.docker(['exec', ids.container, 'dropdb', '-U', 'postgres', 'gestor_ligas_ci'], {}, signal);
        result.databaseCleanup = 'PASSED';
      },
    });
    await record();
  } catch {
    result.failureStage = stage;
    if (['seed', 'clubs'].includes(stage)) result[stage] = 'FAILED';
    await record();
    throw Object.assign(new Error(`CI136 PostgreSQL ${item.major}: fallo en ${stage}; diagnóstico saneado en evidence-pg${item.major}/result.json.`),
      { code: ['seed', 'clubs'].includes(stage) ? 'CI136_CHECKS_FAILED' : 'CI136_INFRASTRUCTURE_FAILED' });
  }
}
