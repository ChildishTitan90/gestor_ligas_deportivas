import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { independentInstallPlan } from './account-independent-dependencies.mjs';
import { childEnvironment } from '../ci/delegate-isolated-runtime.mjs';
import { PREVIEW_ROLE } from '../preview/runtime-plan.mjs';

// No .env, database import or connection before checking the exact isolated target.
export function validateAccountProvisioningTarget(config) {
  const target = new URL(config.databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.equal(target.hostname, '127.0.0.1');
  assert.ok(['55415', '55417'].includes(target.port));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.ok(target.pathname.endsWith(target.port.slice(-2)));
  assert.equal(target.search + target.hash, '');
  assert.equal(config.baseUrl, `http://127.0.0.1:${56500 + Number(target.port.slice(-2))}`);
  const suite = config.suite ?? 'accounts';
  assert.ok(['accounts', 'seasons', 'administrative-reset', 'email-confirmation', 'maintenance-ui', 'maintenance', 'preview-prisma-account', 'maintenance-preview'].includes(suite));
  assert.equal(target.username, suite === 'preview-prisma-account' ? PREVIEW_ROLE : 'postgres');
  if (suite === 'maintenance-preview') {
    const runtime = validateAccountProvisioningTarget({ databaseUrl: config.runtimeDatabaseUrl,
      baseUrl: config.baseUrl, suite: 'preview-prisma-account' });
    const runtimeTarget = new URL(runtime.databaseUrl);
    assert.equal(runtimeTarget.host + runtimeTarget.pathname, target.host + target.pathname);
    return { databaseUrl: target.href, baseUrl: config.baseUrl, suite, runtimeDatabaseUrl: runtime.databaseUrl };
  }
  if (suite === 'administrative-reset') {
    assert.equal(config.runtimeDatabaseUrl,undefined);
    const fixtureUrl=new URL(config.fixture?.url);
    assert.equal(fixtureUrl.protocol,'http:');assert.equal(fixtureUrl.hostname,'127.0.0.1');
    assert.ok(Number(fixtureUrl.port)>1024);assert.equal(fixtureUrl.pathname,'/');
    assert.equal(fixtureUrl.search+fixtureUrl.hash+fixtureUrl.username+fixtureUrl.password,'');
    assert.match(config.fixture.key,/^[A-Za-z0-9_-]{43}$/);
    assert.match(config.fixture.enableFile,/^\/(?:private\/tmp|tmp)\/pdgld106-[a-f0-9-]{36}\/app-pg(?:15|17)\/\.synthetic-email-enabled$/);
    assert.ok(config.fixture.enableFile.endsWith(`app-pg${target.port.slice(-2)}/.synthetic-email-enabled`));
    return {databaseUrl:target.href,baseUrl:config.baseUrl,suite,fixture:config.fixture};
  }
  assert.equal(config.fixture,undefined);
  assert.equal(config.runtimeDatabaseUrl, undefined);
  return { databaseUrl: target.href, baseUrl: config.baseUrl, suite };
}

// node:test may record a failure without rejecting await test(). Require the child
// process's final exit code, not only the async suite's return, before claiming pass.
export function runAccountProvisioningSuite(config, { signal, application } = {}) {
  const target = validateAccountProvisioningTarget(config);
  independentInstallPlan(application); // Exact owned app/UUID/major, no arbitrary executable path.
  assert.equal(application.major, Number(new URL(target.databaseUrl).port.slice(-2)));
  assert.equal(application.dependencies, 'independent');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = fork(`${application.app}/scripts/verification/account-provisioning-entry.mjs`, [], { execArgv: ['administrative-reset','email-confirmation'].includes(target.suite) ? ['--conditions=react-server'] : [], cwd: application.app,
      env: childEnvironment(process.env), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let completed = false; let cancelled = false; let force;
    let failureLocation;
    const stop = () => {
      cancelled = true; child.kill('SIGTERM');
      force ??= setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    signal?.addEventListener('abort', stop, { once: true });
    child.on('message', message => {
      if (message?.completed === true) completed = true;
      if (message?.type === 'maintenance-failure' &&
        /^tests\/(?:integration\/account-(?:identifiers|maintenance-preview)|e2e\/account-(?:administrative-reset|email-confirmation)-browser)\.mjs:\d+:\d+$/.test(message.location ?? ''))
        failureLocation ??= message.location;
    });
    child.once('error', () => { completed = false; });
    child.once('close', code => {
      clearTimeout(force); signal?.removeEventListener('abort', stop);
      if (code === 0 && completed && !cancelled) resolve();
      else {
        const code = target.suite === 'preview-prisma-account' ? 'PREVIEW_PRISMA_ACCOUNT_FAILED' : ['administrative-reset','email-confirmation','maintenance-ui','maintenance','maintenance-preview'].includes(target.suite) ? 'ACCOUNT_MAINTENANCE_FAILED' : target.suite === 'seasons' ? 'SEASONS_SUITE_FAILED' : 'ACCOUNT_PROVISIONING_FAILED';
        const failure = Object.assign(new Error(code), { code });
        if (failureLocation) failure.stack = `Error: ${code}\n    at ${failureLocation}`;
        reject(failure);
      }
    });
    if (signal?.aborted) stop(); else child.send(target);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(process.send, 'Solo mediante supervisor IPC.');
  process.once('message', async config => {
    try {
      const target = validateAccountProvisioningTarget(config);
      if (target.suite === 'preview-prisma-account') {
        const { verifyPreviewPrismaAccountCreation } = await import('../../tests/integration/preview-prisma-account.mjs');
        await verifyPreviewPrismaAccountCreation(target);
      } else if (target.suite === 'maintenance-preview') {
        const { runAccountMaintenanceSuite } = await import('../../tests/integration/account-maintenance.test.mjs');
        const { verifyAccountMaintenancePreview } = await import('../../tests/integration/account-maintenance-preview.mjs');
        await verifyAccountMaintenancePreview(target, () => runAccountMaintenanceSuite(target));
      } else if (target.suite === 'administrative-reset') {
        const { verifyAdministrativeResetBrowser } = await import('../../tests/e2e/account-administrative-reset-browser.mjs');
        await verifyAdministrativeResetBrowser(target);
      } else if (target.suite === 'email-confirmation') {
        const { verifyAccountEmailConfirmationBrowser } = await import('../../tests/e2e/account-email-confirmation-browser.mjs');
        await verifyAccountEmailConfirmationBrowser(target);
      } else if (target.suite === 'maintenance-ui') {
        const { prepareMaintenanceUI } = await import('../../tests/integration/account-maintenance-ui-fixtures.mjs');
        await prepareMaintenanceUI(target);
      } else if (target.suite === 'maintenance') {
        const { runAccountMaintenanceSuite } = await import('../../tests/integration/account-maintenance.test.mjs');
        await runAccountMaintenanceSuite(target);
      } else if (target.suite === 'seasons') {
        const { runSeasonIntegrationSuite } = await import('../../tests/integration/seasons.test.mjs');
        await runSeasonIntegrationSuite(target);
      } else {
        // Same existing catalog preparation/cleanup used before accounts in CI.
        // Its approved permission installers act only inside this disposable DB.
        const { runCatalogAccountIntegrationSuite } = await import('../../tests/integration/catalog-accounts.test.mjs');
        await runCatalogAccountIntegrationSuite(target);
        const { runAccountIntegrationSuite } = await import('../../tests/integration/accounts.test.mjs');
        await runAccountIntegrationSuite(target);
      }
      process.send({ completed: true }, () => process.disconnect());
    } catch (error) {
      process.exitCode = 1;
      const location = error?.stack?.match(/tests\/(?:integration\/account-maintenance-preview|e2e\/account-(?:administrative-reset|email-confirmation)-browser)\.mjs:\d+:\d+/)?.[0];
      process.send({ completed: false, ...(location ? { type:'maintenance-failure',location } : {}) }, () => process.disconnect());
    }
  });
}
