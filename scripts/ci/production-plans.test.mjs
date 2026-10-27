import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readMigrations } from './migration-helpers.mjs';
import { AFFILIATION_PLAN, ENROLLMENT_PLAN, assertProductionPlan, sqlChecksum } from './production-plans.mjs';

const directory = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const readSql = name => readFileSync(`${directory}/${name}/migration.sql`, 'utf8');
const allMigrations = readMigrations(directory);
const operationsMigration = '20261026010000_pdgld64_enrollment_operations';
// Los casos del plan aprobado PDGLD-57 conservan sus entradas originales.
// Aislar PDGLD-57 conserva todos los casos de su plan original.
const migrations = new Map([...allMigrations].filter(([name]) => name !== operationsMigration));
const applied = new Set(['0_init']);

test('PDGLD-64 acepta solo el original revisado, incluso con CRLF', () => {
  assert.ok(allMigrations.has(operationsMigration));
  assert.equal(sqlChecksum(readSql(operationsMigration)), ENROLLMENT_PLAN.checksum);
  for (const eol of ['\n', '\r\n']) {
    assert.deepEqual(assertProductionPlan(allMigrations, applied, n => readSql(n).replace(/\r?\n/g, eol)),
      { pendingCreation: true, pendingEnrollmentCreation: true });
  }
});
test('PDGLD-64 rechaza checksum alterado pendiente y ya aplicado', () => {
  for (const history of [applied, new Set(allMigrations.keys())]) {
    assert.throws(() => assertProductionPlan(allMigrations, history,
      n => readSql(n) + (n === operationsMigration ? '\n-- alterado' : '')), /PDGLD-64.*checksum/);
  }
});
test('PDGLD-64 admite el pendiente con PDGLD-57 aplicado y el reintento actualizado', () => {
  assert.deepEqual(assertProductionPlan(allMigrations, new Set(migrations.keys()), readSql),
    { pendingCreation: false, pendingEnrollmentCreation: true });
  assert.deepEqual(assertProductionPlan(allMigrations, new Set(allMigrations.keys()), readSql),
    { pendingCreation: false, pendingEnrollmentCreation: false });
});

test('autoriza únicamente la migración PDGLD-57 exacta con su protección posterior', () => {
  assert.deepEqual(assertProductionPlan(migrations, applied, readSql), { pendingCreation: true, pendingEnrollmentCreation: false });
});
test('el checksum revisado tolera finales de línea de Windows sin alterar el SQL', () => {
  assert.deepEqual(assertProductionPlan(migrations, applied, name => readSql(name).replace(/\r?\n/g, '\r\n')), { pendingCreation: true, pendingEnrollmentCreation: false });
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
  assert.deepEqual(assertProductionPlan(migrations, new Set(migrations.keys()), readSql), { pendingCreation: false, pendingEnrollmentCreation: false });
});
