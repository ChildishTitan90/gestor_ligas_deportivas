import assert from 'node:assert/strict';
import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { verifyDelegatePositionMigration } from '../../tests/integration/delegate-positions-migration.mjs';
import { RUN_ID } from '../ci/delegate-isolated-runtime.mjs';

process.once('message', async config => {
  let admin;
  let created = false;
  let failure;
  try {
    assert.ok(process.send, 'Solo mediante supervisor IPC.');
    assert.equal(config.host, '127.0.0.1');
    assert.match(config.runId, RUN_ID);
    assert.ok([15, 17].includes(config.major));
    assert.equal(config.port, 55400 + config.major);
    assert.match(config.parentDatabase, /^pdgld48_test_[a-f0-9]{16}$/);
    assert.match(config.modelDatabase, /^pdgld106_model_[a-f0-9]{16}$/);
    const stem = config.runId.replaceAll('-', '').slice(0, 14);
    assert.equal(config.parentDatabase, `pdgld48_test_${stem}${config.major}`);
    assert.equal(config.modelDatabase, `pdgld106_model_${stem}${config.major}`);
    assert.equal(typeof config.password, 'string');
    admin = new pg.Client({ host: config.host, port: config.port, database: 'postgres', user: 'postgres',
      password: config.password, ssl: false, connectionTimeoutMillis: 5_000, statement_timeout: 15_000 });
    await admin.connect();
    assert.equal(Math.floor(Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num) / 10_000), config.major);
    await admin.query(`CREATE DATABASE "${config.parentDatabase}"`);
    created = true;
    const url = new URL(`postgresql://postgres@127.0.0.1:${config.port}/${config.parentDatabase}`);
    url.password = config.password;
    const checks = await verifyDelegatePositionMigration(url.href, { expectedPort: config.port, databaseName: config.modelDatabase });
    const evidence = `/private/tmp/pdgld106-${config.runId}/evidence-pg${config.major}`;
    await mkdir(evidence, { recursive: true, mode: 0o700 });
    await writeFile(`${evidence}/agreed-rules.json`, JSON.stringify({ scope: 'new-agreed-rule-tests', checks }, null, 2), { flag: 'wx', mode: 0o600 });
  } catch (error) { failure = error; }
  finally {
    try {
      if (created) {
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [config.parentDatabase]);
        await admin.query(`DROP DATABASE "${config.parentDatabase}"`);
      }
    } catch { failure = new Error('PARENT_CLEANUP_FAILED'); }
    finally { await admin?.end().catch(() => { failure ??= new Error('ADMIN_CLOSE_FAILED'); }); }
  }
  const code = failure ? (/^[A-Z0-9_]{1,40}$/.test(failure.code ?? '') ? failure.code : 'MODEL_SUITE_FAILED') : 'OK';
  const constraint = /^[a-z][a-z0-9_]{0,100}$/.test(failure?.constraint ?? '') ? failure.constraint : undefined;
  const location = failure?.stack?.match(/(?:delegate-positions-migration|representative-agreed-rules|authorization-clock)\.mjs:\d+:\d+/)?.[0];
  process.send({ type: 'result', ok: !failure, code, constraint, location }, () => {
    process.disconnect(); process.exitCode = failure ? 1 : 0;
  });
});
