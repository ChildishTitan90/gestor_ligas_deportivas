import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountDiagnostic, nextStartupObserver, captureMaskedFailure, writeAccountDiagnostic } from '../verification/account-diagnostics.mjs';

test('worker location survives without serializing messages or full stack', () => {
  const error = { code: 'ERR_ASSERTION', message: 'password=SECRET',
    stack: 'SECRET\n at run (/repo/scripts/verification/account-isolated-worker.mjs:103:12)', actual: false, expected: true };
  const result = accountDiagnostic(error, { case: 'next-readiness', stage: 'next-startup', safeValues: true });
  assert.equal(result.location, 'scripts/verification/account-isolated-worker.mjs:103:12');
  assert.equal(result.actual, false); assert.equal(result.expected, true);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('assertion values are opt-in and never serialize strings or objects', () => {
  for (const value of ['cookie=SECRET', { token: 'SECRET' }, undefined, Infinity]) {
    const result = accountDiagnostic({ actual: value, expected: value }, { safeValues: true });
    assert.equal('actual' in result, false); assert.equal('expected' in result, false);
  }
  assert.equal('actual' in accountDiagnostic({ actual: 403, expected: 200 }), false);
  assert.equal(accountDiagnostic({}, { case: 'postgresql://SECRET' }).case, 'unknown');
});
test('startup log classifier handles split chunks and stores only fixed categories', () => {
  const observer = nextStartupObserver();
  observer.output('SECRET cookie Authorization: Bearer TOKEN Module not ');
  observer.output('found postgresql://user:PASS@host EADDRINUSE');
  observer.status(500); observer.exit(1);
  assert.deepEqual(observer.summary(), { signals: ['module-resolution', 'port-occupied'], httpStatus: 500, exitCode: 1 });
  assert.ok(!JSON.stringify(observer.summary()).includes('SECRET'));
});
test('artifact persists after cleanup of the app and only masked screenshots are requested', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'account-diagnostic-test-'));
  try {
    const calls = [];
    const command = async (method, params) => {
      calls.push({ method, params });
      return method === 'Runtime.evaluate' ? { result: { value: true } } : { data: Buffer.from('synthetic-not-a-real-image').toString('base64') };
    };
    await writeAccountDiagnostic(directory, accountDiagnostic({}));
    assert.equal(JSON.parse(await readFile(join(directory, 'failure.json'), 'utf8')).stage, 'unknown');
    assert.equal(await captureMaskedFailure(command, directory), true);
    assert.equal(calls[0].method, 'Runtime.evaluate');
    assert.match(calls[0].params.expression, /visibility: hidden/);
    assert.match(calls[0].params.expression, /color: transparent/);
    assert.equal(calls[1].method, 'Page.captureScreenshot');
    assert.equal(await captureMaskedFailure(async () => { throw Error('secret'); }, directory), false);
    assert.equal(await captureMaskedFailure(async () => ({ exceptionDetails: {} }), directory), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('startup probe plan never starts services and rejects destination overrides', async () => {
  const { startupProbePlan } = await import('../verification/account-startup-probe.mjs');
  const id = '9b20d39a-8e8c-4a92-91ea-3fcc8f7d6a21';
  const plan = startupProbePlan(['--run-id', id]);
  assert.equal(plan.execute, false); assert.equal(plan.database, false);
  assert.equal(plan.docker, false); assert.equal(plan.chrome, false);
  assert.equal(plan.url, 'http://127.0.0.1:56515');
  assert.throws(() => startupProbePlan(['--run-id', id, '--port', '5432']));
  assert.throws(() => startupProbePlan(['--run-id', '../escape']));
});

test('module diagnosis retains only exact identifiers from copied code and dependency filenames', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { startupModuleAllowlist } = await import('../verification/account-startup-probe.mjs');
  const root = await mkdtemp(join(tmpdir(), 'startup-modules-'));
  try {
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'node_modules/next/dist'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { next: 'synthetic' } }));
    await writeFile(join(root, 'src/route.ts'), 'import { options } from "@/server/auth/options"; import x from "next/server";');
    await writeFile(join(root, 'node_modules/next/dist/example.js'), 'do-not-read-dependency-content');
    const allowedModules = await startupModuleAllowlist(root);
    assert.ok(allowedModules.includes('@/server/auth/options'));
    assert.ok(allowedModules.includes('next/server'));
    assert.ok(allowedModules.includes('/ROOT/node_modules/next/dist/example.js'));
    const observer = nextStartupObserver({ allowedModules });
    observer.output("Module not found: Can't resolve 'next/server'\nCannot find module 'cookie=SECRET'\n");
    observer.output("Module not found: Can't resolve '/ROOT/node_modules/next/dist/example.js'");
    assert.deepEqual(observer.summary().unresolvedModules, ['/ROOT/node_modules/next/dist/example.js', 'next/server']);
    assert.ok(!JSON.stringify(observer.summary()).includes('SECRET'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('external resolution classification keeps fixed categories and no raw context', () => {
  const observer = nextStartupObserver({ allowedModules: ['pg'] });
  observer.output("Package pg can't be external: could not be resolved from the project directory. cookie=SECRET");
  assert.deepEqual(observer.summary(), { signals: ['external-package-resolution'], httpStatus: null, exitCode: null, unresolvedModules: [] });
  assert.ok(!JSON.stringify(observer.summary()).includes('SECRET'));
});

test('private probe capture preserves original bytes and diagnostics without following symlinks', async () => {
  const { privateStartupCapture, preserveStartupDiagnostics } = await import('../verification/account-startup-probe.mjs');
  const { mkdir, writeFile, stat, symlink } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'startup-private-test-'));
  try {
    const directory = join(root, 'private');
    const capture = await privateStartupCapture(directory);
    capture.output('stdout', Buffer.from('original\x1b[31m bytes\n'));
    capture.output('stderr', Buffer.from('synthetic-secret\n'));
    capture.close();
    assert.equal(await readFile(join(directory, 'next-stdout.log'), 'utf8'), 'original\x1b[31m bytes\n');
    assert.equal(await readFile(join(directory, 'next-stderr.log'), 'utf8'), 'synthetic-secret\n');
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, 'next-stderr.log'))).mode & 0o777, 0o600);
    await assert.rejects(privateStartupCapture(directory), /EEXIST/);
    const app = join(root, 'app');
    await mkdir(join(app, '.next-auth-tests/diagnostics'), { recursive: true });
    await writeFile(join(app, 'next.config.ts'), 'synthetic config');
    await writeFile(join(app, '.next-auth-tests/diagnostics/error.json'), 'synthetic diagnostic');
    await mkdir(join(app, '.next-auth-tests/dev'), { recursive: true });
    await writeFile(join(app, '.next-auth-tests/dev/trace'), 'synthetic trace');
    await writeFile(join(root, 'excluded'), 'do not copy');
    await symlink(join(root, 'excluded'), join(app, '.next-auth-tests/diagnostics/link'));
    await preserveStartupDiagnostics(app, directory);
    assert.equal(await readFile(join(directory, '.next-auth-tests/diagnostics/error.json'), 'utf8'), 'synthetic diagnostic');
    assert.equal((await stat(join(directory, 'next.config.ts'))).mode & 0o777, 0o600);
    assert.equal(await readFile(join(directory, '.next-auth-tests/dev/trace'), 'utf8'), 'synthetic trace');
    await assert.rejects(stat(join(directory, '.next-auth-tests/diagnostics/link')), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('independent probe plan is explicit, rejects extra options and creates no resources', async () => {
  const { startupProbePlan } = await import('../verification/account-startup-probe.mjs');
  const { independentInstallPlan } = await import('../verification/account-independent-dependencies.mjs');
  const { existsSync } = await import('node:fs');
  const { randomUUID } = await import('node:crypto');
  const id = randomUUID();
  const plan = startupProbePlan(['--independent-dependencies', '--run-id', id]);
  assert.equal(plan.execute, false); assert.equal(plan.dependencies, 'independent');
  assert.equal(plan.installation, 'npm ci'); assert.equal(existsSync(plan.directory), false);
  const spec = independentInstallPlan(plan);
  assert.equal(spec.command, 'npm'); assert.equal(spec.args[0], 'ci');
  assert.ok(spec.args.includes('--include=dev'));
  assert.ok(!spec.args.includes('--ignore-scripts'));
  assert.equal(spec.cwd, plan.app);
  assert.ok(spec.args.filter(arg => /cache=|config=/.test(arg)).every(arg => arg.includes(plan.directory)));
  assert.equal(startupProbePlan(['--execute', '--independent-dependencies', '--run-id', id]).execute, true);
  assert.equal(startupProbePlan(['--run-id', id]).dependencies, 'linked');
  assert.throws(() => startupProbePlan(['--independent-dependencies', '--run-id', id, '--registry', 'other']));
  assert.throws(() => independentInstallPlan({ ...plan, app: '/outside' }));
});

test('independent copy preserves package and lock bytes, has no dependency link or extra root', async () => {
  const { createAccountAppCopy, configureAccountTurbopack } = await import('../verification/account-app-copy.mjs');
  const { mkdir, writeFile, lstat } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'independent-copy-test-'));
  try {
    await mkdir(join(root, 'src'));
    const packageBytes = '{"scripts":{"postinstall":"prisma generate"}}\n';
    const lockBytes = '{"lockfileVersion":3}\n';
    const config = 'const nextConfig = { turbopack: { rules: {} }, experimental: { agentUpgrade: "security" } };\nexport default nextConfig;';
    await writeFile(join(root, 'package.json'), packageBytes);
    await writeFile(join(root, 'package-lock.json'), lockBytes);
    await writeFile(join(root, 'next.config.ts'), config);
    await createAccountAppCopy(root, join(root, 'copy'), { dependencies: 'independent' });
    await assert.rejects(lstat(join(root, 'copy/node_modules')), /ENOENT/);
    for (const file of ['package.json', 'package-lock.json'])
      assert.deepEqual(await readFile(join(root, 'copy', file)), await readFile(join(root, file)));
    await configureAccountTurbopack(join(root, 'copy'), root, { dependencies: 'independent' });
    const copiedConfig = await readFile(join(root, 'copy/next.config.ts'), 'utf8');
    assert.ok(copiedConfig.includes(JSON.stringify(join(root, 'copy'))));
    assert.doesNotMatch(copiedConfig, /installedDependencies|turbopackAdditionalRoots|resolveAlias|serverExternalPackages/);
    assert.equal(await readFile(join(root, 'next.config.ts'), 'utf8'), config);
    await assert.rejects(createAccountAppCopy(root, join(root, 'invalid'), { dependencies: 'unknown' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('independent install rejects script changes, isolates environment and detects lockfile mutation', async () => {
  const { installIndependentDependencies } = await import('../verification/account-independent-dependencies.mjs');
  const { startupProbePlan } = await import('../verification/account-startup-probe.mjs');
  const { randomUUID } = await import('node:crypto');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const plan = startupProbePlan(['--independent-dependencies', '--run-id', randomUUID()]);
  await mkdir(plan.app, { recursive: true });
  let called = false;
  const capture = { output() { throw new Error('No real installer should run'); } };
  try {
    await writeFile(join(plan.app, 'package.json'), JSON.stringify({ scripts: { postinstall: 'prisma migrate deploy' } }));
    await writeFile(join(plan.app, 'package-lock.json'), '{"lockfileVersion":3}');
    await assert.rejects(installIndependentDependencies(plan, capture, undefined, { run: async () => { called = true; } }));
    assert.equal(called, false);
    await writeFile(join(plan.app, 'package.json'), JSON.stringify({ scripts: { postinstall: 'prisma generate' } }));
    await assert.rejects(installIndependentDependencies(plan, capture, undefined, {
      environment: { PATH: '/synthetic', DATABASE_URL: 'SECRET', DIRECT_URL: 'SECRET', NODE_OPTIONS: 'SECRET', npm_config_userconfig: '/personal' },
      run: async (spec, env) => {
        called = true;
        assert.deepEqual(Object.keys(env).sort(), ['NEXT_TELEMETRY_DISABLED', 'NODE_ENV', 'PATH', 'TMPDIR', 'XDG_CACHE_HOME']);
        assert.ok(env.TMPDIR.startsWith(plan.directory));
        assert.equal(await readFile(join(spec.work, 'user.npmrc'), 'utf8'), '');
        await writeFile(join(plan.app, 'package-lock.json'), 'changed');
      },
    }), /LOCKFILE_CHANGED/);
    assert.equal(called, true);
  } finally { await rm(plan.directory, { recursive: true, force: true }); }
});
