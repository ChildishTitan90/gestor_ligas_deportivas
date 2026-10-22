import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readMigrations } from './migration-helpers.mjs';
import { AFFILIATION_PLAN, assertProductionPlan } from './production-plans.mjs';

const directory = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const readSql = name => readFileSync(`${directory}/${name}/migration.sql`, 'utf8');
const migrations = readMigrations(directory);
const applied = new Set(['0_init']);

test('autoriza únicamente la migración PDGLD-57 exacta con su protección posterior', () => {
  assert.deepEqual(assertProductionPlan(migrations, applied, readSql), { pendingCreation: true });
});
test('el checksum revisado tolera finales de línea de Windows sin alterar el SQL', () => {
  assert.deepEqual(assertProductionPlan(migrations, applied, name => readSql(name).replace(/\r?\n/g, '\r\n')), { pendingCreation: true });
});
test('rechaza cambios al SQL autorizado, incluso si conservan el mismo nombre', () => {
  assert.throws(() => assertProductionPlan(migrations, applied, name => readSql(name) + '\n-- cambio'), /checksums/);
});
test('exige la migración de seguridad y su checksum', () => {
  const missing = new Map(migrations); missing.delete(AFFILIATION_PLAN.securityMigration);
  assert.throws(() => assertProductionPlan(missing, applied, readSql), /dos migraciones/);
  assert.throws(() => assertProductionPlan(migrations, applied, name => name === AFFILIATION_PLAN.securityMigration ? 'SELECT 1;' : readSql(name)), /checksums/);
});
test('no autoriza otra tabla ni desactivar RLS en migraciones futuras', () => {
  for (const sql of ['CREATE TABLE arbitrary (id uuid);', 'ALTER TABLE sports_management.clubs DISABLE ROW LEVEL SECURITY;']) {
    const extended = new Map([...migrations, ['20261023000000_unreviewed', new Set()]]);
    assert.throws(() => assertProductionPlan(extended, applied, name => name === '20261023000000_unreviewed' ? sql : readSql(name)), /plan de seguridad/);
  }
});
test('conserva el orden y permite reintentar cuando todas están aplicadas', () => {
  const unordered = new Map([...migrations].reverse());
  assert.throws(() => assertProductionPlan(unordered, applied, readSql), /en orden/);
  assert.deepEqual(assertProductionPlan(migrations, new Set(migrations.keys()), readSql), { pendingCreation: false });
});
