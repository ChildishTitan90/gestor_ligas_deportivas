import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { childEnvironment, RUN_ID } from '../ci/delegate-isolated-runtime.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

export function independentInstallPlan(plan) {
  let work;
  if (plan.directory.startsWith('/private/tmp/pdgld-startup-')) {
    const id = plan.directory.slice('/private/tmp/pdgld-startup-'.length);
    assert.match(id, RUN_ID);
    assert.equal(plan.app, `${plan.directory}/app`);
    assert.equal(plan.major, undefined);
    work = `${plan.directory}/npm-work`;
  } else {
    const id = plan.directory.slice('/private/tmp/pdgld106-'.length);
    assert.match(id, RUN_ID);
    assert.equal(plan.directory, `/private/tmp/pdgld106-${id}`);
    assert.ok([15, 17].includes(plan.major));
    assert.equal(plan.app, `${plan.directory}/app-pg${plan.major}`);
    work = `${plan.directory}/npm-work-pg${plan.major}`;
  }
  return { command: 'npm', cwd: plan.app, work, args: ['ci', '--include=dev', '--foreground-scripts',
    '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/',
    `--cache=${work}/cache`, `--userconfig=${work}/user.npmrc`, `--globalconfig=${work}/global.npmrc`],
  timeoutMs: 600_000 };
}

export function accountApplicationPlan({ runId, major, verificationMode }) {
  assert.match(runId, RUN_ID);
  assert.ok([15, 17].includes(major));
  assert.ok(['http', 'browser', 'preview'].includes(verificationMode));
  const independent = verificationMode !== 'http';
  const directory = `/private/tmp/pdgld106-${runId}`;
  return { directory, app: `${directory}/app-pg${major}`, major,
    evidence: `${directory}/evidence-pg${major}`,
    dependencies: independent ? 'independent' : 'linked',
    bundler: independent ? '--turbopack' : '--webpack' };
}

export function accountWorkerTimeout(verificationMode) {
  assert.ok(['http', 'browser', 'preview'].includes(verificationMode));
  // Ten minutes for npm ci plus the existing ten-minute account verification budget.
  return verificationMode === 'http' ? 600_000 : 1_200_000;
}

// A private process group owns npm and lifecycle children. Never run through a shell.
async function runInstall(spec, environment, capture, signal) {
  assert.notEqual(process.platform, 'win32');
  signal?.throwIfAborted();
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: environment,
    detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let failed = false; let timedOut = false; let killTimer;
  const kill = how => {
    if (!child.pid) return;
    try { process.kill(-child.pid, how); } catch (error) { if (error.code !== 'ESRCH') failed = true; }
  };
  const stop = () => { kill('SIGTERM'); killTimer ??= setTimeout(() => kill('SIGKILL'), 2000); };
  child.stdout.on('data', chunk => capture.output('stdout', chunk));
  child.stderr.on('data', chunk => capture.output('stderr', chunk));
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, spec.timeoutMs);
  try {
    const code = await new Promise(resolve => {
      child.once('error', () => { failed = true; });
      child.once('close', resolve);
    });
    signal?.throwIfAborted();
    assert.equal(timedOut, false, 'NPM_INSTALL_TIMEOUT');
    assert.equal(failed, false, 'NPM_INSTALL_FAILED');
    assert.equal(code, 0, 'NPM_INSTALL_FAILED');
  } finally {
    clearTimeout(timer); clearTimeout(killTimer);
    signal?.removeEventListener('abort', stop);
    kill('SIGTERM'); kill('SIGKILL');
  }
}

export async function installIndependentDependencies(plan, capture, signal, { environment = process.env, run = runInstall } = {}) {
  const spec = independentInstallPlan(plan);
  const packageFile = join(plan.app, 'package.json'); const lockFile = join(plan.app, 'package-lock.json');
  const before = { package: hash(await readFile(packageFile)), lock: hash(await readFile(lockFile)) };
  const pkg = JSON.parse(await readFile(packageFile, 'utf8'));
  // Review the installation effects again if project lifecycle scripts change.
  assert.equal(pkg.scripts?.postinstall, 'prisma generate');
  for (const name of ['preinstall', 'install', 'prepublish', 'preprepare', 'prepare', 'postprepare'])
    assert.equal(pkg.scripts?.[name], undefined, 'UNREVIEWED_INSTALL_SCRIPT');
  await assert.rejects(lstat(join(plan.app, 'node_modules')), { code: 'ENOENT' });
  await mkdir(spec.work, { mode: 0o700 });
  for (const name of ['user.npmrc', 'global.npmrc'])
    await writeFile(join(spec.work, name), '', { mode: 0o600, flag: 'wx' });
  await mkdir(join(spec.work, 'tmp'), { mode: 0o700 });
  const env = { ...childEnvironment(environment), NODE_ENV: 'development',
    TMPDIR: join(spec.work, 'tmp'), XDG_CACHE_HOME: join(spec.work, 'cache'), NEXT_TELEMETRY_DISABLED: '1' };
  await run(spec, env, capture, signal);
  assert.equal(hash(await readFile(packageFile)), before.package, 'PACKAGE_CHANGED');
  assert.equal(hash(await readFile(lockFile)), before.lock, 'LOCKFILE_CHANGED');
  assert.equal((await lstat(join(plan.app, 'node_modules'))).isSymbolicLink(), false);
  assert.equal(await realpath(join(plan.app, 'node_modules')), join(await realpath(plan.app), 'node_modules'));
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  const versions = {};
  for (const name of ['next', 'pg', '@prisma/adapter-pg', '@prisma/client', 'prisma', 'react', 'react-dom']) {
    const installed = JSON.parse(await readFile(join(plan.app, 'node_modules', name, 'package.json'), 'utf8'));
    assert.equal(installed.version, lock.packages[`node_modules/${name}`].version, 'INSTALLED_VERSION_MISMATCH');
    versions[name] = installed.version;
  }
  const require = createRequire(packageFile);
  for (const name of ['pg', '@prisma/adapter-pg', 'next/dist/bin/next', '.prisma/client/default']) {
    const resolved = await realpath(require.resolve(name));
    assert.ok(resolved.startsWith(`${await realpath(plan.app)}/node_modules/`), 'DEPENDENCY_OUTSIDE_COPY');
  }
  return { packageSha256: before.package, lockSha256: before.lock, versions };
}
