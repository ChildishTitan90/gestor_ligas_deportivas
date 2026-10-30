import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readlink, rm, symlink } from 'node:fs/promises';
import {
  createDelegatePlan, containerArgs, labels, assertIsolatedContainer,
  childEnvironment, executeDelegateMatrix, cleanupDelegateResources,
  isMissingDockerResource,
} from './delegate-isolated-runtime.mjs';
import { parseDelegateArguments, restoreDelegateRegistry } from '../test-delegate-isolated.mjs';
import { accountAppFiles, accountCopyAllowed, createAccountAppCopy, configureAccountTurbopack } from '../verification/account-app-copy.mjs';
import { accountApplicationPlan, accountWorkerTimeout, independentInstallPlan } from '../verification/account-independent-dependencies.mjs';
import { authorizationAt } from '../../tests/integration/authorization-clock.mjs';
import { assertChromeEndpoint } from '../../tests/e2e/chrome-session.mjs';

const runId = '10600000-0000-4000-8000-000000000001';
const plan = () => createDelegatePlan(runId, 'a'.repeat(32));
const id = (major, suffix) => `${major}${suffix}`.padStart(64, '0');

test('solo reconoce recursos ausentes con el nombre exacto, sin ocultar errores del daemon', () => {
  const name = plan().versions[0].network;
  assert.equal(isMissingDockerResource('network', name, `Error response from daemon: network ${name} not found\n`), true);
  assert.equal(isMissingDockerResource('container', name, `Error response from daemon: No such container: ${name}`), true);
  for (const message of ['permission denied', 'Cannot connect to the Docker daemon',
    'Error response from daemon: network foreign not found'])
    assert.equal(isMissingDockerResource('network', name, message), false);
});
function container(p, item) {
  return { Id: id(item.major, '1'), Name: `/${item.container}`, State: { Running: true },
    Config: { Image: item.image, Labels: labels(p, item) },
    HostConfig: { Privileged: false, NetworkMode: item.network, PublishAllPorts: false,
      Binds: [], VolumesFrom: [], Tmpfs: { '/var/lib/postgresql/data': 'rw,nosuid,nodev' } },
    Mounts: [{ Type: 'tmpfs', Destination: '/var/lib/postgresql/data' }],
    NetworkSettings: { Networks: { [item.network]: {} },
      Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(item.port) }] } } };
}

function fake(options = {}) {
  const p = plan();
  const events = [];
  const records = [];
  const containers = new Map();
  const networks = new Map();
  let recordCount = 0;
  const lookup = (map, name) => [...map.values()].find(value => value.Id === name || value.Name.replace(/^\//, '') === name);
  const io = {
    secret: () => 'synthetic-password-never-recorded', progress: () => {},
    record: async value => {
      records.push(structuredClone(value));
      recordCount++;
      if (options.recordFailure === recordCount) throw new Error('registry fixture failure');
    },
    docker: async (args, environment = {}) => {
      events.push({ args: [...args], passwordProvided: !!environment.POSTGRES_PASSWORD });
      if (args[0] === 'network' && args[1] === 'create') {
        const item = p.versions.find(item => item.network === args.at(-1));
        const network = { Id: id(item.major, '2'), Name: item.network, Labels: labels(p, item), Driver: 'bridge', Scope: 'local', Containers: {} };
        networks.set(network.Id, network);
        if (options.lostNetworkReply) throw new Error('lost reply');
        return network.Id;
      }
      if (args[0] === 'create') {
        const item = p.versions.find(item => item.image === args.at(-1));
        const object = container(p, item);
        if (options.wrongLabel) object.Config.Labels['pdgld106.owner'] = 'foreign';
        containers.set(object.Id, object);
        networks.get(id(item.major, '2')).Containers[object.Id] = {};
        return object.Id;
      }
      if (args[0] === 'start') return args[1];
      if (args[0] === 'rm') {
        if (options.removeFailure) throw new Error('remove failed');
        containers.delete(args[2]);
        for (const net of networks.values()) delete net.Containers[args[2]];
        return args[2];
      }
      if (args[0] === 'network' && args[1] === 'rm') { networks.delete(args[2]); return args[2]; }
      throw new Error('unexpected Docker fixture command');
    },
    inspectOptional: async (kind, name) => lookup(kind === 'container' ? containers : networks, name),
    inspect: async (kind, name) => {
      const value = await io.inspectOptional(kind, name); assert.ok(value); return structuredClone(value);
    },
    ready: async () => { if (options.readyFailure) throw new Error('not ready'); },
    worker: async config => {
      events.push({ worker: config.major });
      assert.equal(config.host, '127.0.0.1');
      assert.equal(config.port, 55400 + config.major);
      if (options.abort) { options.abort.abort(); throw new Error('cancelled and awaited'); }
      if (options.workerFailure) throw new Error('suite failed');
    },
    cleanup: (ownedPlan, item) => cleanupDelegateResources(ownedPlan, item, io),
  };
  return { io, p, events, records, containers, networks };
}

test('el plan fija 15→17, loopback y tmpfs sin montar rutas del proyecto', () => {
  const p = plan();
  assert.deepEqual(p.versions.map(item => item.major), [15, 17]);
  for (const item of p.versions) {
    const args = containerArgs(p, item);
    assert.equal(args[args.indexOf('--publish') + 1], `127.0.0.1:${item.port}:5432`);
    assert.equal(args.includes('--volume'), false);
    assert.equal(args.includes('--mount'), false);
    assert.equal(args.includes('--env-file'), false);
    assert.equal(args.join(' ').includes('gestor_ligas_dev'), false);
    assert.equal(args.some(arg => arg.includes('synthetic-password')), false);
  }
});

test('CLI requiere autorización explícita y run-id válido, sin opciones ambiguas', () => {
  assert.equal(parseDelegateArguments(['--run-id', runId]).mode, 'plan');
  assert.equal(parseDelegateArguments(['--execute', '--run-id', runId]).mode, 'execute');
  for (const args of [[], ['--execute'], ['--run-id', '../foreign'], ['--run-id', runId, '--execute', '--cleanup'], ['--run-id', runId, '--env-file', '.env']])
    assert.throws(() => parseDelegateArguments(args));
});

test('PDGLD-107 se selecciona explícitamente y su copia excluye configuración sensible', () => {
  assert.equal(parseDelegateArguments(['--run-id', runId]).accountIntegration, false);
  assert.equal(parseDelegateArguments(['--run-id', runId, '--account-integration']).accountIntegration, true);
  assert.throws(() => parseDelegateArguments(['--run-id', runId, '--account-integration', '--account-integration']));
  for (const name of ['.env', '.env.local', '.env.production', 'compose.yml', 'prisma.config.ts', '.git']) {
    assert.equal(accountCopyAllowed(name), false);
    assert.equal(accountAppFiles.includes(name), false);
  }
  assert.equal(accountAppFiles.includes('src'), true);
  assert.equal(accountAppFiles.includes('node_modules'), false);
});

test('navegador y Preview son perfiles separados, nunca ejecutados por defecto', () => {
  assert.equal(parseDelegateArguments(['--run-id', runId, '--account-browser']).accountMode, 'browser');
  assert.equal(parseDelegateArguments(['--run-id', runId, '--account-preview']).accountMode, 'preview');
  for (const flags of [['--account-browser', '--account-preview'], ['--account-integration', '--account-browser'], ['--account-preview', '--account-preview']])
    assert.throws(() => parseDelegateArguments(['--run-id', runId, ...flags]));
});

test('CDP solo acepta el endpoint local de un navegador propio', () => {
  assertChromeEndpoint('ws://127.0.0.1:43210/devtools/browser/fixture');
  for (const url of ['ws://remote.example.test:43210/devtools/browser/fixture', 'wss://127.0.0.1:43210/devtools/browser/fixture',
    'ws://127.0.0.1:43210/other', 'ws://user:pass@127.0.0.1:43210/devtools/browser/fixture']) assert.throws(() => assertChromeEndpoint(url));
});

test('la copia elimina solo sus archivos, conserva dependencias y rechaza symlinks de origen', async () => {
  const root = await mkdtemp('/private/tmp/pdgld107-copy-test-');
  try {
    await mkdir(`${root}/src`); await mkdir(`${root}/node_modules`);
    await writeFile(`${root}/src/example.ts`, 'export const fixture = true;');
    await writeFile(`${root}/node_modules/fixture.txt`, 'keep');
    const originalConfig = 'const nextConfig = { turbopack: { rules: {} }, experimental: { agentUpgrade: "security" } };\nexport default nextConfig;';
    await writeFile(`${root}/next.config.ts`, originalConfig);
    const copy = await createAccountAppCopy(root, `${root}/copy`);
    assert.equal(await readFile(`${copy}/src/example.ts`, 'utf8'), 'export const fixture = true;');
    assert.equal(await readlink(`${copy}/node_modules`), `${root}/node_modules`);
    await configureAccountTurbopack(copy, root);
    const config = await readFile(`${copy}/next.config.ts`, 'utf8');
    assert.ok(config.includes('turbopackAdditionalRoots'));
    assert.ok(config.includes(`path: ${JSON.stringify(`${root}/node_modules`)}`));
    assert.ok(config.includes(`root: ${JSON.stringify(copy)}`));
    assert.equal(await readFile(`${root}/next.config.ts`, 'utf8'), originalConfig);
    await rm(copy, { recursive: true, force: true });
    assert.equal(await readFile(`${root}/node_modules/fixture.txt`, 'utf8'), 'keep');
    await symlink(`${root}/node_modules`, `${root}/src/unsafe-link`);
    await assert.rejects(createAccountAppCopy(root, `${root}/rejected-copy`), /symlinks/);
    assert.equal(existsSync(`${root}/rejected-copy`), false);
    assert.equal(await readFile(`${root}/node_modules/fixture.txt`, 'utf8'), 'keep');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rechaza cambios de puerto, IP, red, identidad y montajes antes de SQL', () => {
  const p = plan(); const item = p.versions[0];
  assert.equal(assertIsolatedContainer(container(p, item), p, item), 55415);
  for (const mutate of [
    value => { value.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0'; },
    value => { value.NetworkSettings.Ports['5432/tcp'][0].HostPort = '5432'; },
    value => { value.Config.Labels['pdgld106.owner'] = 'foreign'; },
    value => { value.Name = '/gestor_ligas_dev'; },
    value => { value.Id = 'not-an-id'; },
    value => { value.Config.Image = 'postgres:18'; },
    value => { value.HostConfig.Privileged = true; },
    value => { value.HostConfig.Binds = ['/project:/data']; },
    value => { value.Mounts = [{ Type: 'volume', Destination: '/var/lib/postgresql/data' }]; },
    value => { value.NetworkSettings.Networks.foreign = {}; },
    value => { value.NetworkSettings.Ports['80/tcp'] = []; },
  ]) { const object = container(p, item); mutate(object); assert.throws(() => assertIsolatedContainer(object, p, item)); }
});

test('el hijo no hereda .env loaders, PG*, conexiones ni opciones/contexto Docker', () => {
  assert.deepEqual(childEnvironment({ PATH: '/bin', NODE_OPTIONS: '--env-file=.env', DATABASE_URL: 'foreign',
    DIRECT_URL: 'foreign', PGHOST: 'remote', PGOPTIONS: '-c role=admin', DOCKER_HOST: 'ssh://foreign',
    DOCKER_CONTEXT: 'production', SUPABASE_URL: 'foreign', HOME: '/user' }), { PATH: '/bin' });
});

test('matriz secuencial limpia 15 antes de crear 17 y nunca registra contraseñas', async () => {
  const f = fake(); const resources = await executeDelegateMatrix(f.p, f.io);
  assert.deepEqual(resources.map(item => [item.major, item.passed, item.cleaned]), [[15, true, true], [17, true, true]]);
  const firstRemoved = f.events.findIndex(event => event.args?.[0] === 'network' && event.args[1] === 'rm');
  const secondCreated = f.events.findLastIndex(event => event.args?.[0] === 'network' && event.args[1] === 'create');
  assert.ok(firstRemoved < secondCreated);
  assert.equal(f.containers.size + f.networks.size, 0);
  assert.equal(JSON.stringify(f.records).includes('synthetic-password'), false);
  assert.equal(f.records[0].resources[0].containerId, undefined);
  assert.match(f.records[0].resources[0].modelDatabase, /^pdgld106_model_/);
});

test('fallo de suite, readiness o registro limpia recursos y no inicia 17', async () => {
  for (const options of [{ workerFailure: true }, { readyFailure: true }, { recordFailure: 3 }]) {
    const f = fake(options);
    await assert.rejects(executeDelegateMatrix(f.p, f.io));
    assert.equal(f.containers.size + f.networks.size, 0);
    assert.equal(f.events.some(event => event.worker === 17), false);
  }
});

test('creación con respuesta perdida se recupera por nombre exacto y token propio', async () => {
  const f = fake({ lostNetworkReply: true });
  await assert.rejects(executeDelegateMatrix(f.p, f.io));
  assert.equal(f.networks.size, 0);
});

test('una cancelación espera al worker y después limpia, sin continuar la matriz', async () => {
  const controller = new AbortController();
  const f = fake({ abort: controller });
  await assert.rejects(executeDelegateMatrix(f.p, f.io, controller.signal));
  assert.equal(f.containers.size + f.networks.size, 0);
  assert.equal(f.events.some(event => event.worker === 17), false);
});

test('fallo de limpieza queda registrado y detiene la matriz', async () => {
  const f = fake({ removeFailure: true });
  await assert.rejects(executeDelegateMatrix(f.p, f.io), /Limpieza incompleta/);
  assert.equal(f.records.at(-1).resources[0].pending, true);
  assert.equal(f.events.some(event => event.worker === 17), false);
  assert.ok(f.containers.size > 0);
});

test('etiquetas ajenas nunca autorizan eliminación ni ejecución de SQL', async () => {
  const f = fake({ wrongLabel: true });
  await assert.rejects(executeDelegateMatrix(f.p, f.io), /Limpieza incompleta/);
  assert.equal(f.events.some(event => event.worker), false);
  assert.equal(f.events.some(event => event.args?.[0] === 'rm'), false);
});

test('la recuperación valida el registro completo antes de acceder a Docker', () => {
  const p = plan(); const resource = { ...p.versions[0], containerId: id(15, '1'), networkId: id(15, '2') };
  assert.equal(restoreDelegateRegistry({ plan: p, resources: [resource] }, runId).resources.length, 1);
  for (const mutate of [
    value => { value.plan.dockerHost = 'ssh://foreign'; },
    value => { value.resources[0].container = 'gestor_ligas_dev'; },
    value => { value.resources[0].containerId = '--all'; },
    value => { value.resources[0].parentDatabase = 'gestor_ligas_dev'; },
  ]) {
    const value = structuredClone({ plan: p, resources: [resource] }); mutate(value);
    assert.throws(() => restoreDelegateRegistry(value, runId));
  }
});

test('plan ejecutable sin Docker disponible no crea archivos ni conecta servicios', async () => {
  const execution = randomUUID();
  const path = `/private/tmp/pdgld106-${execution}`;
  assert.equal(existsSync(path), false);
  for (const extra of [[], ['--account-integration'], ['--account-browser'], ['--account-preview']]) {
    const output = await new Promise((resolve, reject) => execFile(process.execPath,
      ['scripts/test-delegate-isolated.mjs', '--run-id', execution, ...extra], { env: { PATH: '/nonexistent' } },
      (error, stdout) => error ? reject(error) : resolve(stdout)));
    const data = JSON.parse(output);
    assert.equal(data.mode, 'plan');
    if (extra.length) assert.deepEqual(data.applicationPorts, ['127.0.0.1:56515', '127.0.0.1:56517']);
    if (extra.some(flag => ['--account-browser', '--account-preview'].includes(flag)))
      assert.ok(data.application.every(app => app.installation.command === 'npm' && app.bundler === '--turbopack'));
  }
  assert.equal(existsSync(path), false);
});

// Node resolution is a precondition, not evidence that Turbopack resolves the same graph.
test('Node resuelve una dependencia transitiva desde la copia sin copiar dependencias ni entorno', async () => {
  const root = await mkdtemp('/private/tmp/pdgld107-resolution-test-');
  try {
    await mkdir(`${root}/src`);
    await mkdir(`${root}/node_modules/fixture-adapter`, { recursive: true });
    await mkdir(`${root}/node_modules/fixture-driver`, { recursive: true });
    await writeFile(`${root}/package.json`, JSON.stringify({ dependencies: { 'fixture-adapter': '1.0.0' } }));
    await writeFile(`${root}/node_modules/fixture-adapter/package.json`, JSON.stringify({ main: 'index.cjs' }));
    await writeFile(`${root}/node_modules/fixture-adapter/index.cjs`, 'module.exports = require("fixture-driver");');
    await writeFile(`${root}/node_modules/fixture-driver/package.json`, JSON.stringify({ main: 'index.cjs' }));
    await writeFile(`${root}/node_modules/fixture-driver/index.cjs`, 'module.exports = "synthetic-driver";');
    await createAccountAppCopy(root, `${root}/copy`);
    const source = createRequire(`${root}/package.json`);
    const copy = createRequire(`${root}/copy/package.json`);
    assert.equal(copy.resolve('fixture-driver'), source.resolve('fixture-driver'));
    const adapter = createRequire(copy.resolve('fixture-adapter'));
    assert.equal(adapter.resolve('fixture-driver'), source.resolve('fixture-driver'));
    assert.equal(copy('fixture-adapter'), 'synthetic-driver');
    await rm(`${root}/copy`, { recursive: true, force: true });
    assert.equal(await readFile(`${root}/node_modules/fixture-driver/index.cjs`, 'utf8'), 'module.exports = "synthetic-driver";');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('browser y Preview usan dependencias propias por PG y Turbopack, con plazo para instalación', () => {
  for (const verificationMode of ['browser', 'preview']) {
    const runtimes = [15, 17].map(major => accountApplicationPlan({ runId, major, verificationMode }));
    assert.notEqual(runtimes[0].app, runtimes[1].app);
    assert.notEqual(independentInstallPlan(runtimes[0]).work, independentInstallPlan(runtimes[1]).work);
    for (const runtime of runtimes) {
      assert.equal(runtime.dependencies, 'independent');
      assert.equal(runtime.bundler, '--turbopack');
      const install = independentInstallPlan(runtime);
      assert.equal(install.cwd, runtime.app);
      assert.ok(install.work.endsWith(`npm-work-pg${runtime.major}`));
      assert.equal(accountWorkerTimeout(verificationMode), install.timeoutMs + 600_000);
      assert.throws(() => independentInstallPlan({ ...runtime, app: runtime.app.replace('pg'+runtime.major, 'pg16') }));
    }
  }
  const http = accountApplicationPlan({ runId, major: 15, verificationMode: 'http' });
  assert.equal(http.dependencies, 'linked'); assert.equal(http.bundler, '--webpack');
  assert.equal(accountWorkerTimeout('http'), 600_000);
  for (const patch of [{ runId: '../foreign' }, { major: 16 }, { verificationMode: 'other' }])
    assert.throws(() => accountApplicationPlan({ runId, major: 15, verificationMode: 'browser', ...patch }));
});

test('copias browser y Preview conservan lockfile y configuración sin raíz adicional ni dependencias externas', async () => {
  const source = await mkdtemp('/private/tmp/account-profile-source-');
  const execution = randomUUID(); const scratch = `/private/tmp/pdgld106-${execution}`;
  try {
    await mkdir(`${source}/src`);
    await mkdir(scratch, { mode: 0o700 });
    await writeFile(`${source}/package.json`, '{"scripts":{"postinstall":"prisma generate"}}\n');
    await writeFile(`${source}/package-lock.json`, '{"lockfileVersion":3}\n');
    const config = 'const nextConfig={turbopack:{rules:{}},experimental:{agentUpgrade:"security"}};\nexport default nextConfig;';
    await writeFile(`${source}/next.config.ts`, config);
    for (const [verificationMode, major] of [['browser', 15], ['preview', 17]]) {
      const runtime = accountApplicationPlan({ runId: execution, major, verificationMode });
      await createAccountAppCopy(source, runtime.app, { dependencies: runtime.dependencies });
      assert.equal(existsSync(`${runtime.app}/node_modules`), false);
      await configureAccountTurbopack(runtime.app, source, { dependencies: runtime.dependencies });
      assert.doesNotMatch(await readFile(`${runtime.app}/next.config.ts`, 'utf8'), /installedDependencies|turbopackAdditionalRoots|resolveAlias|serverExternalPackages/);
      assert.deepEqual(await readFile(`${runtime.app}/package-lock.json`), await readFile(`${source}/package-lock.json`));
    }
    assert.equal(await readFile(`${source}/next.config.ts`, 'utf8'), config);
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test('reloj de autorización de pruebas conserva parámetros y solo sustituye el reloj SQL', async () => {
  const calls = [];
  const tx = { marker: 'original', $queryRaw(strings, ...values) { calls.push({ strings: [...strings], raw: [...strings.raw], values }); return Promise.resolve('executed'); },
    other() { return this.marker; } };
  const clock = authorizationAt(tx, '2035-01-01T00:00:00.123456Z');
  const identifier = "unchanged parameter with ' quotes";
  assert.equal(await clock.tx.$queryRaw`SELECT clock_timestamp(), ${identifier}::text`, 'executed');
  assert.deepEqual(calls[0].values, [identifier]);
  assert.ok(calls[0].strings[0].includes("TIMESTAMPTZ '2035-01-01T00:00:00.123456Z'"));
  assert.deepEqual(calls[0].strings, calls[0].raw);
  await clock.tx.$queryRaw`SELECT ${identifier}::text`;
  assert.equal(clock.clockStatements(), 1);
  assert.equal(clock.tx.other(), 'original');
  assert.throws(() => authorizationAt(tx, "2035-01-01'; SELECT SECRET"));
  assert.equal(Object.keys(tx).includes('clockStatements'), false);
});

test('las regresiones rechazan destinos ajenos antes de consultar o cargar guards', async () => {
  const { verifyRepresentativeAgreedRules } = await import('../../tests/integration/representative-agreed-rules.mjs');
  const db = { query() { throw new Error('must not query'); } };
  for (const url of ['postgresql://localhost:5432/gestor_ligas_dev', 'postgresql://remote.example.test:55415/pdgld106_model_0123456789abcdef',
    'postgresql://127.0.0.1:55415/pdgld106_model_0123456789abcdef?schema=other'])
    await assert.rejects(verifyRepresentativeAgreedRules(db, url), error => error.message !== 'must not query');
});
