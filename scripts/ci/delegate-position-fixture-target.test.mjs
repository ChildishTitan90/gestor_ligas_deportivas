import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDelegatePositionMigration } from '../../tests/integration/delegate-positions-migration.mjs';

test('PDGLD-106: rechaza destinos no desechables antes de conectar', async () => {
  const suffix = 'pdgld48_test_0123456789abcdef';
  const invalid = [
    '',
    `postgresql://fixture@db.example.test:5432/${suffix}`,
    'postgresql://fixture@localhost:5432/postgres',
    'postgresql://fixture@localhost:5432/gestor_ligas',
    `postgresql://fixture@localhost:6543/${suffix}`,
    `postgresql://fixture@localhost:5432/${suffix}?host=db.example.test`,
    `postgresql://fixture@localhost:5432/${suffix}#fragment`,
    `https://localhost:5432/${suffix}`,
  ];
  for (const url of invalid) await assert.rejects(verifyDelegatePositionMigration(url));
  const isolated = `postgresql://fixture@127.0.0.1:55415/${suffix}`;
  await assert.rejects(verifyDelegatePositionMigration(isolated), 'Un puerto aislado no se acepta por defecto.');
  await assert.rejects(verifyDelegatePositionMigration(isolated, { expectedPort: 55417, databaseName: 'pdgld106_model_0123456789abcdef' }));
  await assert.rejects(verifyDelegatePositionMigration(isolated, { expectedPort: 55415, databaseName: 'gestor_ligas_dev' }));
  await assert.rejects(verifyDelegatePositionMigration(isolated, { expectedPort: 5432, databaseName: 'pdgld106_model_0123456789abcdef' }));
});
