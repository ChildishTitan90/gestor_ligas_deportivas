import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile, fork } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accountApplicationPlan, accountWorkerTimeout, independentInstallPlan } from './verification/account-independent-dependencies.mjs';
import {
  RUN_ID, createDelegatePlan, childEnvironment, executeDelegateMatrix, cleanupDelegateResources,
  isMissingDockerResource,
} from './ci/delegate-isolated-runtime.mjs';

export function parseDelegateArguments(args) {
  let runId;
  let mode = 'plan';
  let selected = false;
  let accountIntegration = false;
  let accountMode = 'http';
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--run-id' && runId === undefined) runId = args[++index];
    else if (['--execute', '--cleanup'].includes(args[index]) && !selected) {
      mode = args[index] === '--execute' ? 'execute' : 'cleanup'; selected = true;
    } else if (args[index] === '--account-integration' && !accountIntegration) accountIntegration = true;
    else if (['--account-browser', '--account-preview'].includes(args[index]) && !accountIntegration) {
      accountIntegration = true; accountMode = args[index] === '--account-browser' ? 'browser' : 'preview';
    }
    else throw new Error('Usa --run-id UUID y, opcionalmente, --execute, --cleanup o --account-integration.');
  }
  assert.match(runId ?? '', RUN_ID, 'Falta un UUID v4 válido de ejecución.');
  return { runId, mode, accountIntegration, accountMode };
}

export const accountSuiteNames = { http: 'PDGLD-107 HTTP/SSR', browser: 'PDGLD-107 navegador', preview: 'PDGLD-107 Preview/RLS temporal' };
const isAccountRegistry = registry => Object.values(accountSuiteNames).includes(registry.suite);

export function restoreDelegateRegistry(data, runId) {
  const plan = createDelegatePlan(runId, data.plan?.ownerToken ?? '');
  assert.deepEqual(data.plan, plan, 'El registro no corresponde al plan local esperado.');
  assert.ok(Array.isArray(data.resources) && data.resources.length <= 2);
  const resources = data.resources.map((resource, index) => {
    const item = plan.versions[index];
    for (const [key, value] of Object.entries(item)) assert.equal(resource[key], value);
    for (const key of ['containerId', 'networkId']) {
      if (resource[key] !== undefined) assert.match(resource[key], /^[a-f0-9]{64}$/);
    }
    return { ...item, containerId: resource.containerId, networkId: resource.networkId };
  });
  return { plan, resources };
}

function dockerIO(plan, scratch) {
  async function result(args, extra = {}, signal) {
    return new Promise((resolve, reject) => {
      execFile('docker', ['--host', plan.dockerHost, ...args], {
        env: { ...childEnvironment(process.env), DOCKER_CONFIG: `${scratch}/docker`, ...extra },
        encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120_000, signal,
      }, (error, stdout, stderr) => {
        if (error?.code === 'ENOENT' || error?.name === 'AbortError' || error?.killed)
          return reject(new Error('Docker no disponible, cancelado o fuera de plazo.'));
        resolve({ code: error ? error.code : 0, stdout, stderr });
      });
    });
  }
  async function docker(args, extra = {}, signal) {
    const response = await result(args, extra, signal);
    if (response.code !== 0) throw new Error(`Falló Docker (${args[0]}). No se muestran argumentos de conexión ni salida interna.`);
    return response.stdout;
  }
  async function inspectOptional(kind, name) {
    const response = await result([kind, 'inspect', name]);
    if (response.code !== 0) {
      if (response.code === 1 && isMissingDockerResource(kind, name, response.stderr)) return undefined;
      throw new Error('No se pudo verificar la identidad del recurso Docker.');
    }
    const objects = JSON.parse(response.stdout);
    assert.equal(objects.length, 1);
    return objects[0];
  }
  async function inspect(kind, name) {
    const object = await inspectOptional(kind, name);
    assert.ok(object, 'El recurso exclusivo no existe.');
    return object;
  }
  async function ready(containerId, signal) {
    for (let attempt = 0; attempt < 90; attempt++) {
      signal?.throwIfAborted();
      // TCP avoids accepting the temporary Unix-socket-only init server.
      const response = await result(['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'], {}, signal);
      if (response.code === 0) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('PostgreSQL exclusivo no quedó disponible a tiempo.');
  }
  return { docker, inspect, inspectOptional, ready };
}

async function worker(config, signal, accountIntegration = false, accountMode = 'http') {
  // Credentials travel in IPC, never argv, stdout, registry or project .env.
  return new Promise((resolve, reject) => {
    const file = accountIntegration ? './verification/account-isolated-worker.mjs' : './verification/delegate-isolated-worker.mjs';
    const child = fork(fileURLToPath(new URL(file, import.meta.url)), [], {
      execArgv: accountIntegration ? [] : ['--conditions=react-server'], env: childEnvironment(process.env), stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let outcome;
    let cancelled = false;
    let force;
    const stop = () => {
      cancelled = true;
      child.kill('SIGTERM');
      force ??= setTimeout(() => child.kill('SIGKILL'), accountIntegration ? 15_000 : 5_000);
    };
    signal?.addEventListener('abort', stop, { once: true });
    const timeout = setTimeout(stop, accountIntegration ? accountWorkerTimeout(accountMode) : 240_000);
    child.on('message', message => {
      if (message?.type === 'result') outcome = message;
    });
    child.once('error', () => { outcome = { ok: false, code: 'WORKER_START_FAILED' }; });
    // close also fires after a spawn error; exit alone could leave us waiting.
    child.once('close', code => {
      clearTimeout(timeout); clearTimeout(force);
      signal?.removeEventListener('abort', stop);
      if (!cancelled && code === 0 && outcome?.ok) resolve();
      else {
        if (outcome?.diagnostic) console.error(JSON.stringify(outcome.diagnostic));
        reject(new Error(`Suite PostgreSQL ${config.major} fallida o cancelada (${outcome?.code ?? 'WORKER_EXIT'}${outcome?.constraint ? `, ${outcome.constraint}` : ''}${outcome?.location ? `, ${outcome.location}` : ''}).`));
      }
    });
    if (signal?.aborted) stop();
    else child.send({ ...config, verificationMode: accountMode });
  });
}

async function main() {
  const { runId, mode, accountIntegration, accountMode } = parseDelegateArguments(process.argv.slice(2));
  const scratch = `/private/tmp/pdgld106-${runId}`;
  if (mode === 'plan') {
    const plan = createDelegatePlan(runId, '0'.repeat(32));
    console.log(JSON.stringify({ mode, newAgreedRuleChecks: !accountIntegration ? ['distinct-deputies-capacity', 'authorization-inclusive-start-exclusive-end', 'representation-change-preserves-authorship'] : undefined, suite: accountIntegration ? accountSuiteNames[accountMode] : 'PDGLD-106 SQL',
      applicationPorts: accountIntegration ? ['127.0.0.1:56515', '127.0.0.1:56517'] : undefined,
      browser: accountMode === 'browser' ? { profile: `${scratch}/chrome-pg15/17`, debugging: 'solo loopback, puerto efímero de Chrome', artifacts: `${scratch}/evidence-pg15/17` } : undefined,
      application: accountIntegration ? plan.versions.map(item => {
        const runtime = accountApplicationPlan({ runId, major: item.major, verificationMode: accountMode });
        return { ...runtime, installation: runtime.dependencies === 'independent' ? independentInstallPlan(runtime) : null, workerTimeoutMs: accountWorkerTimeout(accountMode) };
      }) : undefined,
      dockerHost: plan.dockerHost, registry: `${scratch}/run.json`, versions: plan.versions }, null, 2));
    return; // No Docker, filesystem writes, .env or SQL in plan mode.
  }
  if (mode === 'cleanup') {
    const registry = JSON.parse(await readFile(`${scratch}/run.json`, 'utf8'));
    const { plan, resources } = restoreDelegateRegistry(registry, runId);
    const io = dockerIO(plan, scratch);
    const failures = await Promise.allSettled(resources.map(async item => {
      const cleanup = await Promise.allSettled([
        cleanupDelegateResources(plan, item, io),
        isAccountRegistry(registry) ? rm(`${scratch}/app-pg${item.major}`, { recursive: true, force: true }) : Promise.resolve(),
        isAccountRegistry(registry) ? rm(`${scratch}/chrome-pg${item.major}`, { recursive: true, force: true }) : Promise.resolve(),
        isAccountRegistry(registry) ? rm(`${scratch}/npm-work-pg${item.major}`, { recursive: true, force: true }) : Promise.resolve(),
      ]);
      if (cleanup.some(result => result.status === 'rejected')) throw new Error('Limpieza incompleta.');
    }));
    if (failures.some(result => result.status === 'rejected')) throw new Error(`Recuperación incompleta: ${scratch}/run.json`);
    console.log(`Recursos propios eliminados: ${runId}. Se conserva el registro local sin credenciales.`);
    return;
  }
  const plan = createDelegatePlan(runId, randomBytes(16).toString('hex'));
  await mkdir(scratch, { mode: 0o700 }); // EEXIST prevents reusing an old execution.
  await mkdir(`${scratch}/docker`, { mode: 0o700 });
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Ejecución interrumpida.'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const docker = dockerIO(plan, scratch);
  try {
    await executeDelegateMatrix(plan, {
      ...docker, worker: (config, signal) => worker(config, signal, accountIntegration, accountMode), secret: () => randomBytes(32).toString('base64url'),
      progress: message => console.log(message),
      record: async registry => {
        const temporary = `${scratch}/run-${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ ...registry, suite: accountIntegration ? accountSuiteNames[accountMode] : 'PDGLD-106 SQL', accountMode: accountIntegration ? accountMode : undefined }, null, 2), { flag: 'wx', mode: 0o600 });
        await rename(temporary, `${scratch}/run.json`);
      },
      cleanup: async (ownedPlan, item) => {
        const results = await Promise.allSettled([
          cleanupDelegateResources(ownedPlan, item, docker),
          accountIntegration ? rm(`${scratch}/app-pg${item.major}`, { recursive: true, force: true }) : Promise.resolve(),
          accountIntegration ? rm(`${scratch}/chrome-pg${item.major}`, { recursive: true, force: true }) : Promise.resolve(),
          accountIntegration ? rm(`${scratch}/npm-work-pg${item.major}`, { recursive: true, force: true }) : Promise.resolve(),
        ]);
        if (results.some(result => result.status === 'rejected')) throw new Error('Limpieza incompleta.');
      },
    }, controller.signal);
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
  console.log(`PostgreSQL 15 y 17 aprobados. Registro sin credenciales: ${scratch}/run.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
