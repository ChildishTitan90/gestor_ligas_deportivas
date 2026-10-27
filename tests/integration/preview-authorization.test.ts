import assert from 'node:assert/strict';
import test from 'node:test';
import { getPrisma } from '../../src/server/db/prisma';
import { getActorPermissionGrants } from '../../src/server/auth/authorization';
import { readAccessOverview } from '../../src/features/auth/server/access-overview';
import { INITIAL_PERMISSION_GRANTS } from '../../prisma/permissions-data';

const target = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
assert.equal(target.username, 'gestor_ligas_preview');
const actor = process.env.PREVIEW_TEST_ACTOR!;
assert.match(actor, /^[a-f0-9-]{36}$/);
const prisma = getPrisma();
test('Preview: el autorizador real recupera los 28 permisos del administrador con FOR SHARE y RLS', async () => {
  try {
    const result = await prisma.$transaction(async tx => {
      const identity = await tx.$queryRaw<{ name: string; protected: boolean }[]>`
        SELECT current_user AS name, row_security_active('sports_management.user_roles') AS protected`;
      assert.deepEqual(identity, [{ name: 'gestor_ligas_preview', protected: true }]);
      return { grants: await getActorPermissionGrants(tx, actor), scopes: await readAccessOverview(tx, actor) };
    });
    const expected = INITIAL_PERMISSION_GRANTS.filter(g => g.roleCode === 'SUPERADMIN');
    assert.equal(expected.length, 28);
    assert.equal(result.grants.length, 28);
    assert.deepEqual(result.grants.map(g => `${g.module}:${g.action}`).sort(), expected.map(g => `${g.module}:${g.action}`).sort());
    assert.equal(result.scopes.flatMap(s => s.modules).flatMap(m => m.actions).length, 28);
  } finally { await prisma.$disconnect(); }
});
