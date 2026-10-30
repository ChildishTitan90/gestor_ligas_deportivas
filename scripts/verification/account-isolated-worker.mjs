import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { childEnvironment, RUN_ID } from '../ci/delegate-isolated-runtime.mjs';
import { createAccountAppCopy, configureAccountTurbopack } from './account-app-copy.mjs';
import { prepareAccountDelegateFixtures, verifyAccountDelegateHTTP } from '../../tests/integration/account-delegates-http.mjs';
import { preparePreviewRuntime, verifyPreviewRuntime } from '../../tests/integration/preview-runtime.mjs';
import { verifyAccountPreviewRuntime, verifyScopedAccountPreview } from '../../tests/integration/account-preview-runtime.mjs';
import { verifyAccountDelegateBrowser } from '../../tests/e2e/account-delegates-browser.mjs';
import { accountDiagnostic, nextStartupObserver, writeAccountDiagnostic } from './account-diagnostics.mjs';
import { accountApplicationPlan, independentInstallPlan, installIndependentDependencies } from './account-independent-dependencies.mjs';
import { privateStartupCapture } from './account-startup-probe.mjs';
import { PREVIEW_ROLE } from '../preview/runtime-plan.mjs';

process.once('message', async config => {
  let admin; let db; let app; let applicationPlan; let server; let serverClosed; let failure; let stopping;
  const created = [];
  const diagnosticContext = { case: 'account-suite', stage: 'validate-config' };
  const startupObserver = nextStartupObserver();
  let diagnostic;
  const controller = new AbortController();
  async function stopServer() {
    if (stopping) return stopping;
    if (!server) return;
    const child = server; server = undefined;
    stopping = (async () => {
      child.kill('SIGTERM');
      await Promise.race([serverClosed, new Promise(resolve => setTimeout(resolve, 2_000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await serverClosed;
    })();
    try { await stopping; } finally { stopping = undefined; }
  }
  const stop = () => { controller.abort(); void stopServer(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop); process.once('disconnect', stop);
  try {
    assert.match(config.runId, RUN_ID); assert.ok([15, 17].includes(config.major));
    assert.ok(['http', 'browser', 'preview'].includes(config.verificationMode));
    assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, 55400 + config.major);
    const stem = config.runId.replaceAll('-', '').slice(0, 14);
    assert.equal(config.parentDatabase, `pdgld48_test_${stem}${config.major}`);
    assert.equal(config.modelDatabase, `pdgld106_model_${stem}${config.major}`);
    applicationPlan = accountApplicationPlan(config);
    diagnosticContext.stage = 'database-setup';
    admin = new pg.Client({ host: config.host, port: config.port, database: 'postgres', user: 'postgres',
      password: config.password, ssl: false, connectionTimeoutMillis: 5_000, statement_timeout: 15_000 });
    await admin.connect();
    assert.equal(Math.floor(Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num) / 10_000), config.major);
    for (const database of [config.parentDatabase, config.modelDatabase]) {
      controller.signal.throwIfAborted(); await admin.query(`CREATE DATABASE "${database}"`); created.push(database);
    }
    const applicationDatabase = config.verificationMode === 'preview' ? config.parentDatabase : config.modelDatabase;
    db = new pg.Client({ host: config.host, port: config.port, database: applicationDatabase, user: 'postgres',
      password: config.password, ssl: false, connectionTimeoutMillis: 5_000, statement_timeout: 15_000 });
    await db.connect();
    const migrations = new URL('../../prisma/migrations/', import.meta.url);
    const names = (await readdir(migrations)).filter(name => /^\d/.test(name)).sort();
    const target = '20261028010000_pdgld106_delegate_positions';
    for (const name of names.filter(name => name < target)) {
      controller.signal.throwIfAborted(); await db.query(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
    }
    const fixture = await prepareAccountDelegateFixtures(db, config.verificationMode === 'preview' ? { databaseName: applicationDatabase } : {});
    for (const name of names.filter(name => name >= target)) {
      controller.signal.throwIfAborted(); await db.query(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'));
    }
    diagnosticContext.stage = 'application-copy';
    const root = fileURLToPath(new URL('../../', import.meta.url));
    app = await createAccountAppCopy(root, applicationPlan.app, { dependencies: applicationPlan.dependencies });
    if (applicationPlan.dependencies === 'independent') {
      diagnosticContext.case = 'dependency-installation';
      await mkdir(applicationPlan.evidence, { recursive: true, mode: 0o700 });
      const capture = await privateStartupCapture(`${applicationPlan.evidence}/installation`, 'npm');
      try {
        const installed = await installIndependentDependencies(applicationPlan, capture, controller.signal);
        await writeFile(`${applicationPlan.evidence}/installation.json`, JSON.stringify({ passed: true, ...installed }, null, 2), { flag: 'wx', mode: 0o600 });
      } finally { capture.close(); }
      await configureAccountTurbopack(app, root, { dependencies: 'independent' });
    }
    const baseUrl = `http://127.0.0.1:${56500 + config.major}`;
    const databaseUrl = new URL(`postgresql://postgres@127.0.0.1:${config.port}/${applicationDatabase}`);
    databaseUrl.password = config.password;
    let runtimeConnection;
    const permissionSnapshot = async () => (await db.query('SELECT * FROM sports_management.role_permissions ORDER BY id')).rows;
    if (config.verificationMode === 'preview') {
      // Empty ledger decoy only for ACL tests, not a claimed Prisma deployment history.
      await db.query('CREATE TABLE public._prisma_migrations (id text PRIMARY KEY)');
      const before = await permissionSnapshot();
      const runtimePassword = randomBytes(32).toString('base64url');
      await preparePreviewRuntime(db, applicationDatabase, runtimePassword, { isolatedPort: config.port });
      assert.deepEqual(await permissionSnapshot(), before, 'La provisión no debe modificar RF22.');
      runtimeConnection = { host: config.host, port: config.port, database: applicationDatabase,
        user: PREVIEW_ROLE, password: runtimePassword, ssl: false, connectionTimeoutMillis: 5_000 };
      databaseUrl.username = PREVIEW_ROLE; databaseUrl.password = runtimePassword;
    }
    const environment = { ...childEnvironment(process.env), NODE_ENV: 'development', AUTH_TEST_RUN: '1',
      DATABASE_URL: databaseUrl.href, DIRECT_URL: databaseUrl.href, NEXTAUTH_URL: baseUrl,
      NEXTAUTH_SECRET: randomBytes(48).toString('base64url'), NEXT_TELEMETRY_DISABLED: '1',
      SUPABASE_URL: 'https://storage.example.test', SUPABASE_STORAGE_SERVER_KEY: 'synthetic-not-used' };
    diagnosticContext.stage = 'next-startup';
    let ready = false;
    for (let startup = 0; startup < 2 && !ready; startup++) {
      let reminder = false;
      server = spawn(process.execPath, [`${applicationPlan.dependencies === 'independent' ? app : root}/node_modules/next/dist/bin/next`,
        'dev', applicationPlan.bundler, '--hostname', '127.0.0.1', '--port', String(56500 + config.major)],
      { cwd: app, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
      serverClosed = new Promise(resolve => server.once('close', resolve));
      server.once('error', () => {});
      server.once('exit', code => startupObserver.exit(code));
      const output = chunk => { startupObserver.output(chunk); if (/SecurityFatalError|This command stopped to show the upgrade recommendation/.test(chunk.toString())) reminder = true; };
      server.stdout.on('data', output); server.stderr.on('data', output);
      for (let attempt = 0; attempt < 180; attempt++) {
        controller.signal.throwIfAborted();
        if (!server || server.exitCode !== null || reminder) break;
        try { const response = await fetch(`${baseUrl}/api/auth/csrf`, { signal: AbortSignal.timeout(2_000) }); startupObserver.status(response.status); if (response.ok) { ready = true; break; } } catch { /* Startup still in progress. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!ready) { await stopServer(); if (!reminder) break; }
    }
    diagnosticContext.case = 'next-readiness';
    diagnosticContext.safeValues = true;
    assert.ok(ready, 'El servidor Next aislado no inició.');
    diagnosticContext.safeValues = false;
    diagnosticContext.stage = 'account-verification';
    controller.signal.throwIfAborted();
    if (config.verificationMode === 'browser') {
      await verifyAccountDelegateBrowser({ db, baseUrl, fixture, signal: controller.signal,
        profileDirectory: `/private/tmp/pdgld106-${config.runId}/chrome-pg${config.major}`,
        artifactsDirectory: `/private/tmp/pdgld106-${config.runId}/evidence-pg${config.major}`, diagnosticContext });
    } else {
      await verifyAccountDelegateHTTP({ db, baseUrl, fixture });
      if (runtimeConnection) {
        await verifyAccountPreviewRuntime({ owner: db, connection: runtimeConnection, fixture });
        await verifyScopedAccountPreview({ owner: db, baseUrl, fixture });
        await verifyPreviewRuntime(db);
      }
    }
  } catch (error) {
    failure = error;
    diagnostic = { ...accountDiagnostic(error, diagnosticContext), startup: startupObserver.summary() };
    // Only a validated execution can create diagnostic artifacts.
    if (RUN_ID.test(config.runId) && [15, 17].includes(config.major)) {
      try { await writeAccountDiagnostic(`/private/tmp/pdgld106-${config.runId}/evidence-pg${config.major}`, diagnostic); }
      catch { diagnostic.artifactWriteFailed = true; }
    }
  }
  finally {
    try { await stopServer(); } catch { failure ??= new Error('NEXT_CLEANUP_FAILED'); }
    await db?.end().catch(() => { failure ??= new Error('DB_CLOSE_FAILED'); });
    for (const name of created.reverse()) {
      try {
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
        await admin.query(`DROP DATABASE "${name}"`);
      } catch { failure ??= new Error('DATABASE_CLEANUP_FAILED'); }
    }
    await admin?.end().catch(() => { failure ??= new Error('ADMIN_CLOSE_FAILED'); });
    if (applicationPlan?.dependencies === 'independent')
      await rm(independentInstallPlan(applicationPlan).work, { recursive: true, force: true }).catch(() => { failure ??= new Error('NPM_WORK_CLEANUP_FAILED'); });
    if (app) await rm(app, { recursive: true, force: true }).catch(() => { failure ??= new Error('APP_COPY_CLEANUP_FAILED'); });
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); process.removeListener('disconnect', stop);
  }
  const code = failure ? (/^[A-Z0-9_]{1,40}$/.test(failure.code ?? '') ? failure.code : 'ACCOUNT_SUITE_FAILED') : 'OK';
  const location = diagnostic?.location;
  if (process.connected) process.send({ type: 'result', ok: !failure, code, location, diagnostic }, () => { process.disconnect(); process.exitCode = failure ? 1 : 0; });
  else process.exitCode = 1;
});
