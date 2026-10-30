import assert from 'node:assert/strict';

export const RUN_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DATA = '/var/lib/postgresql/data';

export function isMissingDockerResource(kind, name, stderr) {
  const accepted = [
    `Error response from daemon: No such ${kind}: ${name}`,
    `Error response from daemon: No such object: ${name}`,
    `Error: No such object: ${name}`,
  ];
  if (kind === 'network') accepted.push(`Error response from daemon: network ${name} not found`);
  return stderr.split('\n').some(line => accepted.includes(line.trim()));
}

export function createDelegatePlan(runId, ownerToken) {
  assert.match(runId, RUN_ID, 'Se requiere UUID v4 de ejecución.');
  assert.match(ownerToken, /^[a-f0-9]{32}$/, 'Identificador de propietario inválido.');
  return {
    runId, ownerToken, dockerHost: 'unix:///var/run/docker.sock',
    versions: [15, 17].map(major => ({
      major, image: `postgres:${major}-bookworm`,
      port: 55400 + major,
      container: `pdgld106-${runId}-pg${major}`,
      network: `pdgld106-${runId}-pg${major}-net`,
      parentDatabase: `pdgld48_test_${runId.replaceAll('-', '').slice(0, 14)}${major}`,
      modelDatabase: `pdgld106_model_${runId.replaceAll('-', '').slice(0, 14)}${major}`,
    })),
  };
}

export function labels(plan, item) {
  return { 'pdgld106.run': plan.runId, 'pdgld106.owner': plan.ownerToken, 'pdgld106.major': String(item.major) };
}

export function networkArgs(plan, item) {
  return ['network', 'create', '--driver', 'bridge',
    ...Object.entries(labels(plan, item)).flatMap(([key, value]) => ['--label', `${key}=${value}`]), item.network];
}

export function containerArgs(plan, item) {
  return ['create', '--pull=missing', '--name', item.container, '--network', item.network,
    '--publish', `127.0.0.1:${item.port}:5432`, '--tmpfs', `${DATA}:rw,nosuid,nodev`,
    '--memory', '805306368', '--cpus', '2',
    '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=postgres', '--env', 'POSTGRES_DB=postgres',
    ...Object.entries(labels(plan, item)).flatMap(([key, value]) => ['--label', `${key}=${value}`]), item.image];
}

export function assertOwned(inspected, kind, plan, item, expectedId) {
  const wantedName = kind === 'container' ? item.container : item.network;
  assert.equal(inspected.Name.replace(/^\//, ''), wantedName, 'Nombre de recurso ajeno.');
  assert.match(inspected.Id, /^[a-f0-9]{64}$/);
  if (expectedId) assert.equal(inspected.Id, expectedId, 'Cambió la identidad del recurso.');
  const actualLabels = kind === 'container' ? inspected.Config.Labels : inspected.Labels;
  for (const [key, value] of Object.entries(labels(plan, item))) assert.equal(actualLabels?.[key], value, 'Etiquetas de recurso ajeno.');
}

export function assertIsolatedContainer(inspected, plan, item, expectedId, expectedPort) {
  assertOwned(inspected, 'container', plan, item, expectedId);
  assert.equal(inspected.Config.Image, item.image);
  assert.equal(inspected.State.Running, true);
  assert.equal(inspected.HostConfig.Privileged, false);
  assert.equal(inspected.HostConfig.NetworkMode, item.network);
  assert.equal(inspected.HostConfig.PublishAllPorts, false);
  assert.deepEqual(inspected.HostConfig.Binds ?? [], []);
  assert.deepEqual(inspected.HostConfig.VolumesFrom ?? [], []);
  assert.deepEqual(Object.keys(inspected.HostConfig.Tmpfs ?? {}), [DATA]);
  assert.ok((inspected.Mounts ?? []).every(mount => mount.Type === 'tmpfs' && mount.Destination === DATA), 'No se admiten volúmenes ni bind mounts.');
  assert.deepEqual(Object.keys(inspected.NetworkSettings.Networks), [item.network]);
  assert.deepEqual(Object.keys(inspected.NetworkSettings.Ports), ['5432/tcp']);
  const published = inspected.NetworkSettings.Ports['5432/tcp'];
  assert.equal(published.length, 1);
  assert.equal(published[0].HostIp, '127.0.0.1');
  const port = Number(published[0].HostPort);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Puerto dinámico inválido.');
  assert.equal(port, expectedPort ?? item.port, 'Cambió el destino publicado.');
  return port;
}

export function childEnvironment(environment) {
  // No PG*, DATABASE_URL, DIRECT_URL, NODE_OPTIONS, .env loader or Docker context.
  return Object.fromEntries(['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP'].flatMap(key =>
    environment[key] === undefined ? [] : [[key, environment[key]]]));
}

/** Injected I/O allows lifecycle/failure tests without Docker or PostgreSQL. */
export async function executeDelegateMatrix(plan, io, signal) {
  const resources = [];
  const record = () => io.record({ plan, resources });
  for (const item of plan.versions) {
    const resource = { ...item, pending: true };
    resources.push(resource);
    await record(); // Registry exists before the first resource can be created.
    let failure;
    try {
      signal?.throwIfAborted();
      io.progress(`PostgreSQL ${item.major}: creación de recursos exclusivos.`);
      resource.networkId = (await io.docker(networkArgs(plan, item), {}, signal)).trim();
      assert.match(resource.networkId, /^[a-f0-9]{64}$/);
      await record();
      const password = io.secret();
      resource.containerId = (await io.docker(containerArgs(plan, item), { POSTGRES_PASSWORD: password }, signal)).trim();
      assert.match(resource.containerId, /^[a-f0-9]{64}$/);
      await record();
      await io.docker(['start', resource.containerId], {}, signal);
      const inspected = await io.inspect('container', resource.containerId);
      resource.port = assertIsolatedContainer(inspected, plan, item, resource.containerId);
      const network = await io.inspect('network', resource.networkId);
      assertOwned(network, 'network', plan, item, resource.networkId);
      assert.equal(network.Driver, 'bridge');
      assert.equal(network.Scope, 'local');
      assert.deepEqual(Object.keys(network.Containers ?? {}), [resource.containerId], 'La red contiene recursos ajenos.');
      await record();
      await io.ready(resource.containerId, signal);
      // Recheck exact mapping immediately before allowing the child to connect.
      assertIsolatedContainer(await io.inspect('container', resource.containerId), plan, item, resource.containerId, resource.port);
      signal?.throwIfAborted();
      io.progress(`PostgreSQL ${item.major}: suite del modelo.`);
      await io.worker({ ...item, runId: plan.runId, host: '127.0.0.1', port: resource.port, password }, signal);
      resource.passed = true;
    } catch (error) { failure = error; }
    // This runs only after worker() has stopped/awaited the child, also on abort.
    try {
      await io.cleanup(plan, resource);
      resource.cleaned = true;
      resource.pending = false;
      await record();
    } catch {
      await record();
      throw new Error(`Limpieza incompleta de PostgreSQL ${item.major}; recuperar ejecución ${plan.runId}.`);
    }
    if (failure) throw failure; // Fail fast: never start 17 after a failed 15.
    io.progress(`PostgreSQL ${item.major}: suite aprobada y recursos eliminados.`);
  }
  return resources;
}

export async function cleanupDelegateResources(plan, item, io) {
  // Exact names cover creation succeeded but CLI/registry update was interrupted.
  // The unpredictable owner token prevents adopting an existing same-name resource.
  const errors = [];
  try {
    const container = await io.inspectOptional('container', item.containerId ?? item.container);
    if (container) {
      assertOwned(container, 'container', plan, item, item.containerId);
      await io.docker(['rm', '--force', container.Id]);
    }
  } catch (error) { errors.push(error); }
  try {
    const network = await io.inspectOptional('network', item.networkId ?? item.network);
    if (network) {
      assertOwned(network, 'network', plan, item, item.networkId);
      assert.deepEqual(Object.keys(network.Containers ?? {}), [], 'No eliminar una red con recursos conectados.');
      await io.docker(['network', 'rm', network.Id]);
    }
  } catch (error) { errors.push(error); }
  if (errors.length) throw new Error('No se pudo completar la limpieza de recursos propios.');
}
