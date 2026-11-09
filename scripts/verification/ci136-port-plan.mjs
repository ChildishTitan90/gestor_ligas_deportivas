import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDelegatePlan, assertIsolatedContainer, assertOwned, ISOLATED_TEMP_ROOT } from '../ci/delegate-isolated-runtime.mjs';

export const CI136_PORT = 55433;

// This plan never creates resources or opens a PostgreSQL connection.
export function ci136PortPlan(runId, ownerToken = '0'.repeat(32)) {
  const base = createDelegatePlan(runId, ownerToken);
  return {
    ...base,
    root: `${ISOLATED_TEMP_ROOT}/pdgld106-${runId}`,
    versions: base.versions.map(({ major, image }) => ({ major, image, port: CI136_PORT,
      container: `pdgld118-ci136-${runId}-pg${major}`,
      network: `pdgld118-ci136-${runId}-pg${major}-net`,
    })),
  };
}

// Called by the isolated supervisor with its fresh owner token and recorded IDs.
// Reuse all existing identity/mount/endpoint checks; also require resource limits.
export function assertCI136Target(container, network, plan, item, ids) {
  const canonical = ci136PortPlan(plan.runId);
  assert.match(plan.ownerToken, /^[a-f0-9]{32}$/);
  assert.equal(plan.dockerHost, canonical.dockerHost);
  assert.equal(plan.root, canonical.root);
  assert.deepEqual(item, canonical.versions.find(version => version.major === item.major));
  assert.notEqual(plan.ownerToken, '0'.repeat(32), 'El plan público no autoriza conexiones.');
  assert.match(ids.container, /^[a-f0-9]{64}$/);
  assert.match(ids.network, /^[a-f0-9]{64}$/);
  assert.equal(item.port, CI136_PORT);
  assertIsolatedContainer(container, plan, item, ids.container, CI136_PORT);
  assert.equal(container.HostConfig.Memory, 805306368);
  assert.equal(container.HostConfig.NanoCpus, 2000000000);
  assertOwned(network, 'network', plan, item, ids.network);
  assert.equal(network.Driver, 'bridge');
  assert.equal(network.Scope, 'local');
  assert.deepEqual(Object.keys(network.Containers ?? {}), [ids.container]);
}

// Only the independent copy is adapted. Normal seed/auth validators stay intact.
// Fail closed on source drift and before producing adapted sources without proof.
export function ci136CopySources(sources, proof) {
  assertCI136Target(proof.container, proof.network, proof.plan, proof.item, proof.ids);
  const replaceOnce = (source, before, after) => {
    assert.equal(source.split(before).length, 2, 'Cambió el guard del runner; revisar manualmente.');
    return source.replace(before, after);
  };
  return {
    auth: replaceOnce(sources.auth,
      "!['5432', '5433'].includes(target.port || '5432')",
      "!['55433'].includes(target.port)"),
    seed: replaceOnce(sources.seed,
      "!['5432', '5433'].includes(target.port)",
      "!['55433'].includes(target.port)"),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, 'Uso: node scripts/verification/ci136-port-plan.mjs --run-id UUID');
  assert.equal(process.argv[2], '--run-id');
  const plan = ci136PortPlan(process.argv[3]);
  delete plan.ownerToken;
  console.log(JSON.stringify({ mode: 'PLAN_ONLY', ...plan,
    sequence: 'PG15 -> aprobación y limpieza verificada -> PG17 -> limpieza',
    commandsInVerifiedIndependentCopy: ['CI=true npm run test:seed -- --existing', 'node scripts/test-auth.mjs --club-maintenance'],
    executableSupervisor: `node scripts/test-delegate-isolated.mjs --ci136 --run-id ${plan.runId} --execute`,
    executionRequires: 'autorización explícita; este comando solo muestra el plan',
  }, null, 2));
}
