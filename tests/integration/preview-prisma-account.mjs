import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PREVIEW_ROLE } from '../../scripts/preview/runtime-plan.mjs';

/** Se ejecuta con el cliente generado en la copia/CI, nunca como propietario. */
export async function verifyPreviewPrismaAccountCreation({ databaseUrl }) {
  const target = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.ok(['5432', '5433', '55415', '55417'].includes(target.port));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.username, PREVIEW_ROLE);
  assert.equal(target.search + target.hash, '');
  const runtime = new pg.Client({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }),
    log: [{ emit: 'event', level: 'query' }] });
  // Solo se retiene una señal del SQL, nunca parámetros, contraseñas o filas.
  let insertIncludesRevision = false;
  prisma.$on('query', event => {
    if (/INSERT INTO "sports_management"\."users"\s*\([^)]*"maintenance_revision"/.test(event.query))
      insertIncludesRevision = true;
  });
  const rollback = new Error('SYNTHETIC_PREVIEW_ACCOUNT_ROLLBACK');
  await runtime.connect();
  try {
    const identity = (await runtime.query(`SELECT current_user AS actor,
      row_security_active('sports_management.users') AS protected`)).rows[0];
    assert.deepEqual(identity, { actor: PREVIEW_ROLE, protected: true });
    const acl = (await runtime.query(`SELECT
      has_column_privilege(current_user,'sports_management.users','maintenance_revision','INSERT') AS insert_revision,
      has_column_privilege(current_user,'sports_management.users','maintenance_revision','UPDATE') AS update_revision,
      has_table_privilege(current_user,'sports_management.users','INSERT') AS insert_table,
      has_table_privilege(current_user,'sports_management.users','UPDATE') AS update_table`)).rows[0];
    assert.deepEqual(acl, { insert_revision: true, update_revision: false, insert_table: false, update_table: false });
    const counts = async () => (await runtime.query(`SELECT
      (SELECT count(*)::int FROM sports_management.people) AS people,
      (SELECT count(*)::int FROM sports_management.users) AS users`)).rows[0];
    const before = await counts();
    await assert.rejects(prisma.$transaction(async tx => {
      const person = await tx.people.create({ data: { first_name: 'Sintética', paternal_surname: 'Preview' }, select: { id: true } });
      const suffix = randomUUID();
      // Igual que el alta de producto: omitir la revisión deja el default a Prisma.
      const account = await tx.users.create({ data: { person_id: person.id,
        username: `preview-${suffix}`, email: `${suffix}@example.test`, password_hash: 'synthetic-not-a-login-hash' },
      select: { id: true, maintenance_revision: true } });
      assert.equal(account.maintenance_revision, 0);
      assert.equal(insertIncludesRevision, true, 'El cliente actualizado incluye la revisión en INSERT.');
      throw rollback;
    }), error => error === rollback);
    assert.deepEqual(await counts(), before, 'El fixture Prisma se revierte completo.');
    await assert.rejects(runtime.query('UPDATE sports_management.users SET maintenance_revision=maintenance_revision WHERE false'), { code: '42501' });
    await assert.rejects(runtime.query('UPDATE sports_management.users SET is_active=is_active WHERE false'), { code: '42501' });
    console.log('PDGLD-118 Preview: alta Prisma con revisión 0, RLS activo y UPDATE/ACL de tabla denegados; fixture revertido.');
  } finally {
    await prisma.$disconnect();
    await runtime.end();
  }
}
