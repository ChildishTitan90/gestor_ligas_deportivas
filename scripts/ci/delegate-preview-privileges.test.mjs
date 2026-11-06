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

test('PDGLD-118: altas y mantenimiento usan columnas explícitas, sin permisos adicionales de asignaciones', () => {
  assert.ok(runtimePrivileges.insert.users.includes('maintenance_revision'));
  assert.deepEqual(runtimePrivileges.update.users, [
    'password_hash', 'must_change_password', 'failed_login_attempts', 'locked_until', 'version',
    'username', 'email', 'is_active', 'maintenance_revision',
  ]);
  assert.deepEqual(runtimePrivileges.update.sessions, ['revoked_at', 'last_activity_at', 'expires_at']);
  assert.deepEqual(runtimePrivileges.insert.audit_logs, ['id','user_id','action','table_name','entity_id','previous_data','new_data','reason','occurred_at']);
  assert.equal(runtimePrivileges.update.audit_logs, undefined);
  assert.equal(runtimePrivileges.update.roles, undefined);
  assert.equal(runtimePrivileges.update.user_roles, undefined);
});
