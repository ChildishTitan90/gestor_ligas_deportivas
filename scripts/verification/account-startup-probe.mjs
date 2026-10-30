import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openSync, writeSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chmod, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RUN_ID, childEnvironment } from '../ci/delegate-isolated-runtime.mjs';
import { createAccountAppCopy, configureAccountTurbopack } from './account-app-copy.mjs';
import { independentInstallPlan, installIndependentDependencies } from './account-independent-dependencies.mjs';
import { nextStartupObserver } from './account-diagnostics.mjs';

export function startupProbePlan(args) {
  const execute = args[0] === '--execute';
  const pending = execute ? args.slice(1) : args;
  const independent = pending[0] === '--independent-dependencies';
  const rest = independent ? pending.slice(1) : pending;
  assert.equal(rest.length, 2); assert.equal(rest[0], '--run-id'); assert.match(rest[1], RUN_ID);
  const directory = `/private/tmp/pdgld-startup-${rest[1]}`;
  return { execute, directory, app: `${directory}/app`, url: 'http://127.0.0.1:56515',
    route: '/api/auth/csrf', database: false, docker: false, chrome: false,
    dependencies: independent ? 'independent' : 'linked', installation: independent ? 'npm ci' : null };
}

// Read only source/config allowlisted by the existing copier, never environment files.
export async function startupModuleAllowlist(root) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const modules = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const source = await readFile(path, 'utf8');
        for (const match of source.matchAll(/(?:from\s*|import\s*|require\(\s*)["']([^"'\r\n]+)["']/g)) {
          if (/^@\/[\w.@+\/-]+$/.test(match[1]) || /^(?:@?[\w.-]+)(?:\/[\w.@+\/-]+)*$/.test(match[1]) || /^\.{1,2}\/[\w.@+\/-]+$/.test(match[1])) modules.add(match[1]);
        }
      }
    }
  }
  await visit(join(root, 'src'));
  // Enumerate filenames only, not dependency contents. Turbopack can report
  // package subpaths or virtual-root paths rather than source import specifiers.
  async function dependencyFiles(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const subpath = relative ? `${relative}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await dependencyFiles(path, subpath);
      else {
        for (const prefix of ['', './', '[project]/', '[installedDependencies]/', '/ROOT/'])
          modules.add(`${prefix}${prefix === '[installedDependencies]/' ? '' : 'node_modules/'}${subpath}`);
        modules.add(join(root, 'node_modules', subpath));
      }
    }
  }
  await dependencyFiles(join(root, 'node_modules'));
  return [...modules].sort();
}

// Raw artifacts are private and never included in startup.json or console output.
// This opt-in probe is unauthenticated; successful CSRF bodies are never captured.
export async function privateStartupCapture(directory, prefix = 'next') {
  assert.ok(['next', 'npm'].includes(prefix));
  await mkdir(directory, { mode: 0o700 });
  const handles = new Map();
  for (const stream of ['stdout', 'stderr']) handles.set(stream, openSync(join(directory, `${prefix}-${stream}.log`), 'wx', 0o600));
  return {
    output(stream, chunk) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let offset = 0;
      while (offset < data.length) offset += writeSync(handles.get(stream), data, offset, data.length - offset);
    },
    close() { for (const fd of handles.values()) closeSync(fd); handles.clear(); },
  };
}

export async function preserveStartupDiagnostics(app, directory) {
  async function privateModes(path) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return;
    await chmod(path, stat.isDirectory() ? 0o700 : 0o600);
    if (stat.isDirectory()) for (const entry of await readdir(path)) await privateModes(join(path, entry));
  }
  for (const relative of ['next.config.ts', 'tsconfig.json', '.next-auth-tests/diagnostics', '.next-auth-tests/logs', '.next-auth-tests/dev/logs', '.next-auth-tests/dev/diagnostics', '.next-auth-tests/trace', '.next-auth-tests/dev/trace', '.next-auth-tests/trace-turbopack', '.next-auth-tests/dev/trace-turbopack']) {
    const source = join(app, relative);
    try { await lstat(source); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const target = join(directory, relative);
    await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
    await cp(source, target, { recursive: true, filter: async path => !(await lstat(path)).isSymbolicLink() });
    await privateModes(target);
  }
}

async function main() {
  const plan = startupProbePlan(process.argv.slice(2));
  if (!plan.execute) { console.log(JSON.stringify(plan, null, 2)); return; }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  await mkdir(plan.directory, { mode: 0o700 }); // Never reuse an existing run.
  let child; let closed; let capture; let errorBodySaved = false; let cleanupFailed = false;
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let observer = nextStartupObserver();
  const result = { plan, ready: false, cleaned: false };
  try {
    capture = await privateStartupCapture(join(plan.directory, 'private'));
    await mkdir(join(plan.directory, 'private', 'next-tmp'), { mode: 0o700 });
    observer = nextStartupObserver({ allowedModules: await startupModuleAllowlist(root) });
    const guard = createServer();
    await new Promise((resolve, reject) => { guard.once('error', reject); guard.listen(56515, '127.0.0.1', resolve); });
    await new Promise(resolve => guard.close(resolve));
    await createAccountAppCopy(root, plan.app, { dependencies: plan.dependencies });
    if (plan.dependencies === 'independent') {
      const npmCapture = await privateStartupCapture(join(plan.directory, 'private', 'installation'), 'npm');
      result.installation = { passed: false };
      try {
        const installed = await installIndependentDependencies(plan, npmCapture, abort.signal);
        result.installation = { passed: true, ...installed };
      } finally { npmCapture.close(); }
      observer = nextStartupObserver({ allowedModules: await startupModuleAllowlist(plan.app) });
    }
    await configureAccountTurbopack(plan.app, root, { dependencies: plan.dependencies });
    result.paths = { cwd: plan.app, turbopackRoot: plan.app,
      dependencyLink: `${plan.app}/node_modules`, dependencyTarget: await realpath(`${plan.app}/node_modules`),
      nextEntry: await realpath(join(plan.dependencies === 'independent' ? plan.app : root, 'node_modules/next/dist/bin/next')),
      route: `${plan.app}/src/app/api/auth/[...nextauth]/route.ts` };
    for (let attempt = 0; attempt < 2; attempt++) {
      let reminder = false;
      child = spawn(process.execPath, [result.paths.nextEntry, 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', '56515'], {
        cwd: plan.app, env: { ...childEnvironment(process.env), NODE_ENV: 'development', AUTH_TEST_RUN: '1',
          TMPDIR: join(plan.directory, 'private', 'next-tmp'),
          NEXTAUTH_URL: plan.url, NEXTAUTH_SECRET: randomBytes(48).toString('base64url'), NEXT_TELEMETRY_DISABLED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      closed = new Promise(resolve => child.once('close', resolve));
      child.once('error', () => { result.spawnFailed = true; });
      child.once('exit', code => observer.exit(code));
      const output = chunk => { observer.output(chunk); if (/SecurityFatalError|upgrade recommendation/.test(chunk.toString())) reminder = true; };
      child.stdout.on('data', chunk => { capture.output('stdout', chunk); output(chunk); });
      child.stderr.on('data', chunk => { capture.output('stderr', chunk); output(chunk); });
      for (let poll = 0; poll < 180; poll++) {
        abort.signal.throwIfAborted();
        if (child.exitCode !== null || result.spawnFailed || reminder) break;
        try {
          const response = await fetch(`${plan.url}${plan.route}`, { signal: AbortSignal.timeout(2000) });
          observer.status(response.status);
          // Never capture successful CSRF bodies, cookies or headers. The first
          // bounded error body is private; only allowlisted extraction is public.
          if (response.ok) { result.ready = true; await response.body?.cancel(); break; }
          const reader = response.body?.getReader();
          if (reader) {
            let total = 0; const chunks = [];
            while (total < 64 * 1024) {
              const { value, done } = await reader.read(); if (done) break;
              total += value.length; observer.output(Buffer.from(value));
              if (!errorBodySaved) chunks.push(Buffer.from(value));
            }
            await reader.cancel();
            if (!errorBodySaved) {
              await writeFile(join(plan.directory, 'private', 'first-http-error.bin'), Buffer.concat(chunks), { mode: 0o600, flag: 'wx' });
              errorBodySaved = true;
            }
          }
        } catch { /* Keep the same readiness requirement as the browser worker. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await closed; clearTimeout(timer); child = undefined;
      if (!reminder || result.ready) break;
    }
  } catch { result.probeFailed = true; }
  finally {
    if (child) {
      child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await closed; clearTimeout(timer);
    }
    try {
      capture?.close();
      await preserveStartupDiagnostics(plan.app, join(plan.directory, 'private'));
    } catch { result.privateCaptureFailed = true; }
    await rm(plan.app, { recursive: true, force: true }).catch(() => { cleanupFailed = true; });
    if (plan.dependencies === 'independent')
      await rm(independentInstallPlan(plan).work, { recursive: true, force: true }).catch(() => { cleanupFailed = true; });
    result.cleaned = !cleanupFailed;
    result.startup = observer.summary();
    await writeFile(`${plan.directory}/startup.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready || !result.cleaned) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { console.error('STARTUP_PROBE_FAILED'); process.exitCode = 1; });
