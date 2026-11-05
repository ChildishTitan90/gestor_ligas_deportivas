import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimePrivileges } from '../preview/runtime-plan.mjs';

test('PDGLD-107: Preview puede insertar cargo y vigencia, sin editar ni eliminar asignaciones', () => {
  assert.deepEqual(runtimePrivileges.insert.user_roles, [
    'user_id', 'role_id', 'league_id', 'club_id', 'starts_at', 'delegate_position', 'ends_at',
  ]);
  assert.equal(runtimePrivileges.update.user_roles, undefined);
  assert.equal(runtimePrivileges.remove.includes('user_roles'), false);
  assert.equal(runtimePrivileges.insert.user_roles.includes('ends_at'), true);
});

test('PDGLD-118: el default de revisión se inserta sin ampliar las actualizaciones de users', () => {
  assert.ok(runtimePrivileges.insert.users.includes('maintenance_revision'));
  assert.deepEqual(runtimePrivileges.update.users, [
    'password_hash', 'must_change_password', 'failed_login_attempts', 'locked_until', 'version',
  ]);
});
