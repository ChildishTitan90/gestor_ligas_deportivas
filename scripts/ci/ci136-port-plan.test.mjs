import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ci136PortPlan, ci136CopySources, assertCI136Target } from '../verification/ci136-port-plan.mjs';
import { labels, executeDelegateMatrix, cleanupDelegateResources } from './delegate-isolated-runtime.mjs';
import { executeCI136Checks, ci136SafeCapture } from '../verification/ci136-isolated-suite.mjs';
import { runIsolatedCommand } from '../verification/account-independent-dependencies.mjs';
import { parseDelegateArguments, restoreDelegateRegistry, ci136SuiteName } from '../test-delegate-isolated.mjs';

const sources = {
  auth: await readFile(new URL('../test-auth.mjs', import.meta.url), 'utf8'),
  seed: await readFile(new URL('../test-seed.mjs', import.meta.url), 'utf8'),
};
function proof() {
  const plan = { ...ci136PortPlan('118e2026-1106-4a18-8a15-000000000207'), ownerToken: 'a'.repeat(32) };
  const item = plan.versions[0], ids = { container: 'b'.repeat(64), network: 'c'.repeat(64) };
  return { plan, item, ids,
    container: { Id: ids.container, Name: `/${item.container}`, State: { Running: true },
      Config: { Image: item.image, Labels: labels(plan, item) },
      HostConfig: { Memory: 805306368, NanoCpus: 2000000000, Privileged: false,
        NetworkMode: item.network, PublishAllPorts: false, Binds: [], VolumesFrom: [],
        Tmpfs: { '/var/lib/postgresql/data': 'rw,nosuid,nodev' } },
      Mounts: [{ Type: 'tmpfs', Destination: '/var/lib/postgresql/data' }],
      NetworkSettings: { Networks: { [item.network]: {} },
        Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55433' }] } } },
    network: { Id: ids.network, Name: item.network, Labels: labels(plan, item),
      Driver: 'bridge', Scope: 'local', Containers: { [ids.container]: {} } },
  };
}
function guard(source, name, value) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  const context = { URL, process: { env: { DIRECT_URL: value } }, databaseName: 'gestor_ligas_ci', value };
  return vm.runInNewContext(`${source.slice(start, end)}; ${name}(${name === 'ciUrl' ? 'value' : ''}).port`, context);
}
test('adaptación solo en memoria: 55433 exclusivo; validadores normales conservados', () => {
  const adapted = ci136CopySources(sources, proof());
  for (const [key, name] of [['auth', 'localConnection'], ['seed', 'ciUrl']]) {
    const url = port => `postgresql://synthetic:synthetic@127.0.0.1:${port}/gestor_ligas_ci?schema=public`;
    assert.equal(guard(adapted[key], name, url(55433)), '55433');
    assert.throws(() => guard(sources[key], name, url(55433)));
    for (const port of [5432, 5433]) {
      assert.equal(guard(sources[key], name, url(port)), String(port));
      assert.throws(() => guard(adapted[key], name, url(port)));
    }
    for (const bad of [url(55433).replace('127.0.0.1', 'remote.invalid'),
      `${url(55433)}&host=remote.invalid`, `${url(55433)}#fragment`,
      url(55433).replace('postgresql:', 'https:')])
      assert.throws(() => guard(adapted[key], name, bad));
  }
  assert.throws(() => guard(adapted.seed, 'ciUrl', 'postgresql://127.0.0.1:55433/other'));
  assert.throws(() => ci136CopySources({ ...sources, seed: sources.seed + sources.seed }, proof()));
});
test('rechaza identidad, destino, red, montajes y límites ajenos antes de adaptar', () => {
  const mutations = [
    p => { p.plan.ownerToken = '0'.repeat(32); },
    p => { p.container.Id = 'd'.repeat(64); },
    p => { p.container.Config.Labels['pdgld106.owner'] = 'foreign'; },
    p => { p.container.NetworkSettings.Ports['5432/tcp'][0].HostPort = '5433'; },
    p => { p.container.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0'; },
    p => { p.container.HostConfig.Binds = ['/foreign:/data']; },
    p => { p.container.HostConfig.Privileged = true; },
    p => { p.container.HostConfig.Memory = 0; },
    p => { p.container.HostConfig.NanoCpus = 0; },
    p => { p.network.Containers.foreign = {}; },
    p => { p.network.Id = 'd'.repeat(64); },
    p => { p.item = { ...p.item, container: 'foreign' }; },
  ];
  for (const mutate of mutations) {
    const p = proof(); mutate(p);
    assert.throws(() => ci136CopySources(sources, p));
  }
  const p = proof();
  assert.doesNotThrow(() => assertCI136Target(p.container, p.network, p.plan, p.item, p.ids));
});

test('CI136 exige perfil único, recuperación exacta y propietario privado', () => {
  const p = proof(), runId = p.plan.runId;
  assert.equal(parseDelegateArguments(['--ci136', '--run-id', runId]).ci136, true);
  for (const flags of [['--ci136', '--ci136'], ['--ci136', '--account-browser'], ['--account-maintenance', '--ci136'], ['--ci136', '--port', '5433']])
    assert.throws(() => parseDelegateArguments([...flags, '--run-id', runId]));
  const registry = { suite: ci136SuiteName, plan: p.plan, resources: [{ ...p.item, containerId: p.ids.container, networkId: p.ids.network }] };
  assert.equal(restoreDelegateRegistry(registry, runId).resources[0].port, 55433);
  for (const mutate of [r => { r.plan.versions[0].port = 5433; }, r => { r.resources[0].containerId = 'foreign'; },
    r => { r.plan.ownerToken = '0'.repeat(32); }, r => { r.resources[0].network = 'foreign'; }]) {
    const changed = structuredClone(registry); mutate(changed);
    assert.throws(() => restoreDelegateRegistry(changed, runId));
  }
});

test('seed, clubes y limpieza requieren identidad antes de cada fase; fallo detiene secuencia', async () => {
  for (const fail of [undefined, 'seed', 'clubs', 'cleanup']) {
    const events = [];
    const step = async name => { events.push(name); if (name === fail) throw new Error('synthetic'); };
    const io = { verify: () => step('verify'), seed: () => step('seed'), clubs: () => step('clubs'),
      record: name => step(`record-${name}`), checkDatabaseCleanup: () => step('cleanup') };
    if (fail) await assert.rejects(executeCI136Checks(io)); else await executeCI136Checks(io);
    if (fail === 'seed') assert.deepEqual(events, ['verify', 'seed']);
    else if (fail === 'clubs') assert.deepEqual(events, ['verify', 'seed', 'record-seed', 'verify', 'clubs']);
    else assert.deepEqual(events, ['verify', 'seed', 'record-seed', 'verify', 'clubs', 'record-clubs', 'verify', 'cleanup']);
  }
  await assert.rejects(executeCI136Checks({ verify: async () => { throw new Error('identity'); }, seed: () => assert.fail('No conectar') }));
});

test('diagnóstico de suites descarta secretos y conserva únicamente contadores', () => {
  const output = [];
  const capture = ci136SafeCapture({ output: (_stream, chunk) => output.push(chunk) });
  capture.output('stdout', 'postgresql://synthetic:SECRET@127.0.0.1:55433/db\nℹ pa');
  capture.output('stdout', 'ss 5\n# fail 0\nSet-Cookie: private\nhttps://example.invalid/?token=secret\n');
  assert.deepEqual(output.map(line => JSON.parse(line)), [{ metric: 'pass', count: 5 }, { metric: 'fail', count: 0 }]);
});

test('matriz CI136 libera 55433 antes de cada versión y no inicia 17 tras fallos o limpieza fallida', async () => {
  for (const fail of [undefined, 'port', 'suite', 'cleanup']) {
    const p = proof(), events = [], containers = new Map(), networks = new Map();
    const io = {
      record: async () => {}, progress: () => {}, secret: () => 'synthetic-only',
      beforeVersion: async item => { events.push(`port-${item.major}`); if (fail === 'port') throw new Error('busy'); },
      docker: async args => {
        const item = p.plan.versions.find(item => item.network === args.at(-1) || item.image === args.at(-1));
        if (args[0] === 'network' && args[1] === 'create') {
          const id = String(item.major).padStart(64, 'c');
          networks.set(id, { ...p.network, Id: id, Name: item.network, Labels: labels(p.plan, item), Containers: {} }); return id;
        }
        if (args[0] === 'create') {
          const id = String(item.major).padStart(64, 'b'), object = structuredClone(p.container);
          object.Id = id; object.Name = item.container; object.Config = { Image: item.image, Labels: labels(p.plan, item) };
          object.HostConfig.NetworkMode = item.network; object.NetworkSettings.Networks = { [item.network]: {} };
          containers.set(id, object); [...networks.values()].at(-1).Containers[id] = {}; return id;
        }
        if (args[0] === 'start') return '';
        if (args[0] === 'rm') { containers.delete(args[2]); for (const n of networks.values()) delete n.Containers[args[2]]; return ''; }
        if (args[0] === 'network' && args[1] === 'rm') { networks.delete(args[2]); return ''; }
        assert.fail('Unexpected Docker operation');
      },
      inspectOptional: async (kind, name) => [...(kind === 'container' ? containers : networks).values()].find(o => o.Id === name || o.Name === name),
      ready: async () => {},
      worker: async config => { events.push(`suite-${config.major}`); if (fail === 'suite') throw new Error('suite'); },
      cleanup: async (plan, resource) => {
        await cleanupDelegateResources(plan, resource, io);
        events.push(`clean-${resource.major}`);
        if (fail === 'cleanup') throw new Error('unverified');
      },
    };
    io.inspect = io.inspectOptional;
    if (fail) await assert.rejects(executeDelegateMatrix(p.plan, io)); else await executeDelegateMatrix(p.plan, io);
    assert.equal(containers.size + networks.size, 0);
    assert.deepEqual(events, fail === 'port' ? ['port-15'] : fail ? ['port-15', 'suite-15', 'clean-15']
      : ['port-15', 'suite-15', 'clean-15', 'port-17', 'suite-17', 'clean-17']);
  }
});

test('modo plan del supervisor CI136 funciona sin Docker y no crea su raíz', async () => {
  const runId = '118e2026-1106-4a18-8a15-000000000991';
  const plan = ci136PortPlan(runId);
  assert.equal(existsSync(plan.root), false);
  const stdout = await new Promise((resolve, reject) => execFile(process.execPath,
    [fileURLToPath(new URL('../test-delegate-isolated.mjs', import.meta.url)), '--ci136', '--run-id', runId],
    { env: { PATH: '/not-present' }, timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  const result = JSON.parse(stdout);
  assert.equal(result.mode, 'plan');
  assert.deepEqual(result.versions.map(item => item.port), [55433, 55433]);
  assert.equal(existsSync(plan.root), false);
});

test('comandos aislados exigen exit cero y esperan al hijo cancelado antes de limpiar', async () => {
  const spec = { command: process.execPath, cwd: fileURLToPath(new URL('../../', import.meta.url)),
    timeoutMs: 5000, failureCode: 'SYNTHETIC_SUITE' };
  await assert.rejects(runIsolatedCommand({ ...spec, args: ['-e', 'process.exit(7)'] }, {}, { output() {} }), /SYNTHETIC_SUITE_FAILED/);
  const controller = new AbortController();
  let pid;
  await assert.rejects(runIsolatedCommand({ ...spec, args: ['-e', 'process.stdout.write(String(process.pid)); setInterval(()=>{},1000)'] },
    {}, { output: (_stream, chunk) => { pid = Number(chunk.toString()); controller.abort(); } }, controller.signal));
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
