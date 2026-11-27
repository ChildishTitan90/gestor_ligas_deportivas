import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync('.github/workflows/ci-cd.yml', 'utf8').replace(/\r\n/g, '\n');
const job = workflow.split('\n  billing:\n')[1]?.split('\n  checks:\n')[0];
const gate = workflow.split('\n  checks:\n')[1]?.split('\n  deploy:\n')[0];

test('PDGLD-176 ejecuta el runner real en PG15/17 y pertenece al check requerido', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  assert.equal(scripts['test:billing'], 'node scripts/test-billing-isolated.mjs');
  assert.match(job, /postgres: \[15, 17\]/);
  assert.match(job, /run: npm run test:billing -- --postgres=\$\{\{ matrix.postgres \}\}/);
  assert.doesNotMatch(job, /continue-on-error|if:.*false|\|\| true/);
  assert.match(gate, /needs: \[[^\]]*billing\]/);
  assert.match(gate, /BILLING_RESULT: \$\{\{ needs.billing.result \}\}/);
});

test('El shell del check real rechaza fallo, cancelación y omisión de tesorería', { skip: process.platform === 'win32' ? 'El workflow utiliza sh en Ubuntu; ejecutar test:ci en Linux' : false }, () => {
  const shell = gate.split('run: |')[1].split('\n').map(line => line.trim()).filter(Boolean).join('\n');
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const run = spawnSync('sh', ['-e', '-c', shell], { env: { APP_RESULT: 'success', DATABASE_RESULT: 'success', REFEREEING_RESULT: 'success', MATCH_REPORTS_RESULT: 'success', BILLING_RESULT: result } });
    assert.equal(run.status, result === 'success' ? 0 : 1);
  }
});
