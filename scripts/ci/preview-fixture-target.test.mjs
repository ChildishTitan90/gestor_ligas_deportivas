import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPreviewFixtureTarget } from '../../tests/integration/preview-runtime.mjs';

const database = 'pdgld48_test_1234567890abcdef';
const local = { host: '127.0.0.1', port: 5432, database, user: 'postgres' };

test('Preview acepta el transporte local del cliente, también con puerto publicado o IPv6', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]'])
    for (const port of [5432, '5433']) assertPreviewFixtureTarget({ ...local, host, port }, database);
});

test('Preview rechaza hosts externos, sockets, otro puerto/base/rol antes de escribir fixtures', () => {
  for (const change of [
    { host: '172.18.0.2' }, { host: 'db.loaztwwpwsaqzdtdtvvj.supabase.co' },
    { host: '/var/run/postgresql' }, { port: 6543 }, { port: undefined },
    { database: 'gestor_ligas_dev' }, { database: 'postgres' }, { user: 'gestor_ligas_preview' },
  ]) assert.throws(() => assertPreviewFixtureTarget({ ...local, ...change }, database));
  assert.throws(() => assertPreviewFixtureTarget({ ...local, database: 'gestor_ligas_dev' }, 'gestor_ligas_dev'));
});

test('Preview aislado requiere explícitamente el puerto fijo ya inspeccionado', () => {
  for (const isolatedPort of [55415, 55417]) {
    assertPreviewFixtureTarget({ ...local, port: isolatedPort }, database, { isolatedPort });
    assert.throws(() => assertPreviewFixtureTarget({ ...local, port: isolatedPort }, database));
    assert.throws(() => assertPreviewFixtureTarget({ ...local, host: 'localhost', port: isolatedPort }, database, { isolatedPort }));
  }
  assert.throws(() => assertPreviewFixtureTarget({ ...local, port: 55415 }, database, { isolatedPort: 55417 }));
  assert.throws(() => assertPreviewFixtureTarget({ ...local, port: 6543 }, database, { isolatedPort: 6543 }));
});
