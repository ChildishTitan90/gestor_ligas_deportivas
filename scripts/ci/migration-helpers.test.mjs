import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertAppliedHistory, assertProductionSql, checksumVariants, productionConnection, redact } from './migration-helpers.mjs';

const ref = 'abcdefghijklmnopqrst';
const valid = `postgresql://postgres.${ref}:test-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const sql = 'CREATE TABLE example (id uuid);\n';
const migrations = new Map([['0_init', checksumVariants(sql)]]);
const row = { migration_name: '0_init', checksum: createHash('sha256').update(sql).digest('hex'), finished_at: new Date(), rolled_back_at: null };

test('exige TLS con CA y validación estricta en el pooler de sesión', () => {
  const url = productionConnection(valid + '?pgbouncer=true&sslaccept=accept_invalid_certs', ref, '/tmp/ca.crt');
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('sslaccept'), 'strict');
  assert.equal(url.searchParams.get('sslcert'), '/tmp/ca.crt');
  assert.equal(url.searchParams.get('schema'), 'public');
  assert.equal(url.searchParams.has('pgbouncer'), false);
});

test('rechaza Docker, pooler transaccional, otra base y otro proyecto', () => {
  for (const candidate of [valid.replace(':5432/', ':6543/'), valid.replace('/postgres', '/another_db'), valid.replace(ref, 'zzzzzzzzzzzzzzzzzzzz'), 'postgresql://postgres:test@localhost:5433/gestor_ligas_dev']) {
    assert.throws(() => productionConnection(candidate, ref, '/tmp/ca.crt'));
  }
});

test('descarta parámetros que podrían sustituir el servidor o la configuración TLS', () => {
  const url = productionConnection(valid + '?host=evil.example&sslkey=/tmp/key&ssl=false', ref, '/tmp/ca.crt');
  assert.equal(url.searchParams.has('host'), false);
  assert.equal(url.searchParams.has('sslkey'), false);
  assert.equal(url.searchParams.has('ssl'), false);
  assert.equal(url.searchParams.get('sslaccept'), 'strict');
});

test('acepta conexión directa solo del proyecto indicado', () => {
  assert.equal(productionConnection(`postgresql://postgres:test@db.${ref}.supabase.co:5432/postgres`, ref, '/tmp/ca.crt').hostname, `db.${ref}.supabase.co`);
  assert.throws(() => productionConnection('postgresql://postgres:test@untrusted.example:5432/postgres', ref, '/tmp/ca.crt'));
});

test('tolera LF y CRLF del baseline registrado desde Windows', () => {
  const windowsHash = createHash('sha256').update(sql.replaceAll('\n', '\r\n')).digest('hex');
  assertAppliedHistory([{ ...row, checksum: windowsHash }], migrations);
});

test('rechaza archivos aplicados modificados o ausentes', () => {
  assert.throws(() => assertAppliedHistory([{ ...row, checksum: 'incorrect' }], migrations), /Cambió/);
  assert.throws(() => assertAppliedHistory([row], new Map()), /Falta un archivo/);
});

test('rechaza historial vacío o una migración fallida', () => {
  assert.throws(() => assertAppliedHistory([], migrations), /baseline/);
  assert.throws(() => assertAppliedHistory([{ ...row, finished_at: null }], migrations), /fallida/);
});

test('un rollback no equivale a un baseline aplicado', () => {
  assert.throws(() => assertAppliedHistory([{ ...row, rolled_back_at: new Date() }], migrations), /no está aplicado/);
  assertAppliedHistory([{ ...row, rolled_back_at: new Date(), finished_at: null }, row], migrations);
});

test('rechaza introducir una migración anterior a una ya aplicada en producción', () => {
  const ordered = new Map([...migrations, ['20261012_a', checksumVariants(sql)], ['20261013_b', checksumVariants(sql)]]);
  assertAppliedHistory([row], ordered);
  assert.throws(() => assertAppliedHistory([row, { ...row, migration_name: '20261013_b' }], ordered), /orden/);
});

test('rechaza un historial aplicado en un orden diferente al de reconstrucción', () => {
  const ordered = new Map([...migrations, ['20261012_a', checksumVariants(sql)], ['20261013_b', checksumVariants(sql)]]);
  assert.throws(() => assertAppliedHistory([row, { ...row, migration_name: '20261013_b' }, { ...row, migration_name: '20261012_a' }], ordered), /orden/);
});

test('detiene cambios que requieren plan de seguridad antes de migrar', () => {
  assert.throws(() => assertProductionSql('CREATE TABLE example (id uuid);', 'nueva_tabla'));
  assert.throws(() => assertProductionSql('ALTER TABLE example DISABLE ROW LEVEL SECURITY;', 'rls'));
  assertProductionSql('ALTER TABLE example ADD COLUMN description text;', 'campo');
});

test('omite URL y contraseña al reportar errores', () => {
  const url = new URL(valid);
  const result = redact(`Connection ${valid} password ${url.password}`, [url]);
  assert.equal(result.includes(url.password), false);
  assert.equal(result.includes('postgresql://'), false);
});
