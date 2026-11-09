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
    'username', 'email', 'is_active', 'maintenance_revision', 'email_verified_at', 'admin_reset_expires_at', 'admin_reset_consumed_at',
  ]);
  assert.deepEqual(runtimePrivileges.update.sessions, ['revoked_at', 'last_activity_at', 'expires_at']);
  assert.deepEqual(runtimePrivileges.insert.audit_logs, ['id','user_id','action','table_name','entity_id','previous_data','new_data','reason','occurred_at']);
  assert.equal(runtimePrivileges.update.audit_logs, undefined);
  assert.equal(runtimePrivileges.update.roles, undefined);
  assert.equal(runtimePrivileges.update.user_roles, undefined);
});

test('PDGLD-118: correo pendiente tiene ACL mínimas; reset solo se invalida y el secreto no se reescribe', () => {
  assert.ok(runtimePrivileges.read.includes('account_email_changes'));
  assert.deepEqual(runtimePrivileges.update.account_email_changes,
    ['status','used_at','confirmation_delivery','previous_notice_delivery','completion_notice_delivery']);
  assert.equal(runtimePrivileges.remove.includes('account_email_changes'),false);
  assert.deepEqual(runtimePrivileges.readColumns.password_resets,['user_id','used_at']);
  assert.deepEqual(runtimePrivileges.update.password_resets,['used_at']);
  assert.equal(runtimePrivileges.insert.password_resets,undefined);
});
