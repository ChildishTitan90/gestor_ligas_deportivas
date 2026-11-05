import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { independentInstallPlan } from './account-independent-dependencies.mjs';
import { childEnvironment } from '../ci/delegate-isolated-runtime.mjs';

// No .env, database import or connection before checking the exact isolated target.
export function validateAccountProvisioningTarget(config) {
  const target = new URL(config.databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.equal(target.hostname, '127.0.0.1');
  assert.ok(['55415', '55417'].includes(target.port));
  assert.equal(target.username, 'postgres');
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.ok(target.pathname.endsWith(target.port.slice(-2)));
  assert.equal(target.search + target.hash, '');
  assert.equal(config.baseUrl, `http://127.0.0.1:${56500 + Number(target.port.slice(-2))}`);
  const suite = config.suite ?? 'accounts';
  assert.ok(['accounts', 'seasons', 'maintenance'].includes(suite));
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
    const child = fork(`${application.app}/scripts/verification/account-provisioning-entry.mjs`, [], { execArgv: [], cwd: application.app,
      env: childEnvironment(process.env), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let completed = false; let cancelled = false; let force;
    const stop = () => {
      cancelled = true; child.kill('SIGTERM');
      force ??= setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    signal?.addEventListener('abort', stop, { once: true });
    child.on('message', message => { if (message?.completed === true) completed = true; });
    child.once('error', () => { completed = false; });
    child.once('close', code => {
      clearTimeout(force); signal?.removeEventListener('abort', stop);
      if (code === 0 && completed && !cancelled) resolve();
      else {
        const code = target.suite === 'maintenance' ? 'ACCOUNT_MAINTENANCE_FAILED' : target.suite === 'seasons' ? 'SEASONS_SUITE_FAILED' : 'ACCOUNT_PROVISIONING_FAILED';
        reject(Object.assign(new Error(code), { code }));
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
      if (target.suite === 'maintenance') {
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
    } catch {
      process.exitCode = 1;
      process.send({ completed: false }, () => process.disconnect());
    }
  });
}
