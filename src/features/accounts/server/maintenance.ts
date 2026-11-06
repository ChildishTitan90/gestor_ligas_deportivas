import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { accountListSchema, accountStatusSchema, AccountMaintenanceError,
  assertAdministratorReplacement, assertMaintenanceTransition, accountIdentifiersSchema,
  accountIdentifierChanges, isAccountIdentifierConflict } from "../maintenance-contract";

// No PII deportiva, contraseñas, sesiones, correo ni asignaciones internas en DTO.
const selection = Prisma.sql`u.id, u.username, u.is_active AS "isActive",
  u.maintenance_revision AS revision`;
type Account = { id: string; username: string; isActive: boolean; revision: number };
function accountId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccountMaintenanceError("VALIDATION_ERROR");
}
async function authorize(tx: Prisma.TransactionClient, actor: string, action: "READ" | "UPDATE") {
  // Contexto vacío exige una concesión global no context_only, nunca un ámbito parcial.
  await assertPermission(tx, actor, { module: "users", action, context: {} });
}
export async function listAccounts(input: unknown) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    await authorize(tx, actor.id, "READ");
    const parsed = accountListSchema.safeParse(input);
    if (!parsed.success) throw new AccountMaintenanceError("VALIDATION_ERROR");
    const { page, pageSize, search } = parsed.data;
    // strpos trata %, _ y barras como texto, nunca como comodines SQL.
    const where = Prisma.sql`strpos(lower(u.username), lower(${search})) > 0`;
    const items = await tx.$queryRaw<Account[]>`SELECT ${selection} FROM sports_management.users u
      WHERE ${where} ORDER BY lower(u.username), u.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total
      FROM sports_management.users u WHERE ${where}`;
    return { items, page, pageSize, total: count.total };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function getAccount(id: string) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    await authorize(tx, actor.id, "READ"); accountId(id);
    const [account] = await tx.$queryRaw<Account[]>`SELECT ${selection} FROM sports_management.users u WHERE u.id=${id}::uuid`;
    if (!account) throw new AccountMaintenanceError("ACCOUNT_NOT_FOUND", 404);
    return account;
  });
}

export async function getAccountIdentifiers(id: string) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    await authorize(tx, actor.id, "UPDATE"); accountId(id);
    const [account] = await tx.$queryRaw<{ id: string; username: string; email: string; revision: number }[]>`
      SELECT u.id, u.username, u.email, u.maintenance_revision AS revision
      FROM sports_management.users u WHERE u.id=${id}::uuid`;
    if (!account) throw new AccountMaintenanceError("ACCOUNT_NOT_FOUND", 404);
    return account;
  });
}

export async function changeAccountIdentifiers(id: string, input: unknown) {
  const actor = await requireOperationalUser();
  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx, "exclusive");
      await authorize(tx, actor.id, "UPDATE"); accountId(id);
      const parsed = accountIdentifiersSchema.safeParse(input);
      if (!parsed.success) throw new AccountMaintenanceError("VALIDATION_ERROR");
      const data = parsed.data;
      const [current] = await tx.$queryRaw<(Account & { email: string })[]>`
        SELECT ${selection}, u.email FROM sports_management.users u WHERE u.id=${id}::uuid FOR UPDATE`;
      if (!current) throw new AccountMaintenanceError("ACCOUNT_NOT_FOUND", 404);
      const next = accountIdentifierChanges(current, data);
      // El login admite usernames heredados con @. No crear un acceso ambiguo.
      const [ambiguous] = await tx.$queryRaw<{ found: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM sports_management.users WHERE id<>${id}::uuid AND lower(username)=lower(${next.email})
      ) AS found`;
      if (ambiguous.found) throw new AccountMaintenanceError("DUPLICATE_ACCOUNT", 409);
      // Los índices lower(...) garantizan unicidad incluso ante escritores concurrentes.
      const [updated] = await tx.$queryRaw<Account[]>`UPDATE sports_management.users u
        SET username=${next.username}, email=${next.email}, maintenance_revision=maintenance_revision+1, version=version+1
        WHERE u.id=${id}::uuid RETURNING ${selection}`;
      await tx.sessions.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date() } });
      await tx.audit_logs.create({ data: { user_id: actor.id, action: "UPDATE", table_name: "users", entity_id: id,
        previous_data: { maintenance_revision: current.revision },
        new_data: { maintenance_revision: updated.revision, changed_fields: next.changedFields, sessions_revoked: true },
        reason: data.reason } });
      return { ...updated, sessionsRevoked: true };
    });
  } catch (error) {
    if (isAccountIdentifierConflict(error)) throw new AccountMaintenanceError("DUPLICATE_ACCOUNT", 409);
    throw error;
  }
}
async function protectLastAdministrator(tx: Prisma.TransactionClient, target: string) {
  const [current] = await tx.$queryRaw<{ assigned: boolean }[]>`SELECT EXISTS (
    SELECT 1 FROM sports_management.user_roles ur JOIN sports_management.roles r ON r.id=ur.role_id
    WHERE ur.user_id=${target}::uuid AND r.code='SUPERADMIN'
      AND ur.starts_at <= clock_timestamp() AND (ur.ends_at IS NULL OR ur.ends_at > clock_timestamp())
  ) AS assigned`;
  if (!current.assigned) return;
  const others = await tx.$queryRaw<{ active: boolean; currentAssignment: boolean; globalRead: boolean;
    globalUpdate: boolean; temporarilyBlocked: boolean; mustChangePassword: boolean }[]>`
    SELECT u.is_active AS active, true AS "currentAssignment",
      bool_or(p.module='users' AND p.action='READ' AND NOT rp.context_only AND ur.league_id IS NULL AND ur.club_id IS NULL) AS "globalRead",
      bool_or(p.module='users' AND p.action='UPDATE' AND NOT rp.context_only AND ur.league_id IS NULL AND ur.club_id IS NULL) AS "globalUpdate",
      coalesce(u.locked_until > clock_timestamp(), false) AS "temporarilyBlocked", u.must_change_password AS "mustChangePassword"
    FROM sports_management.users u JOIN sports_management.user_roles ur ON ur.user_id=u.id
    JOIN sports_management.roles r ON r.id=ur.role_id
    LEFT JOIN sports_management.role_permissions rp ON rp.role_id=r.id
    LEFT JOIN sports_management.permissions p ON p.id=rp.permission_id
    WHERE u.id <> ${target}::uuid AND u.is_active AND r.code='SUPERADMIN'
      AND ur.starts_at <= clock_timestamp() AND (ur.ends_at IS NULL OR ur.ends_at > clock_timestamp())
    GROUP BY u.id`;
  assertAdministratorReplacement(others);
}
export async function changeAccountStatus(id: string, input: unknown) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    // Antes de leer autoridad: mismo orden que los demás escritores RF22.
    await lockAuthorization(tx, "exclusive");
    await authorize(tx, actor.id, "UPDATE"); accountId(id);
    const parsed = accountStatusSchema.safeParse(input);
    if (!parsed.success) throw new AccountMaintenanceError("VALIDATION_ERROR");
    const data = parsed.data;
    const [current] = await tx.$queryRaw<Account[]>`SELECT ${selection} FROM sports_management.users u
      WHERE u.id=${id}::uuid FOR UPDATE`;
    if (!current) throw new AccountMaintenanceError("ACCOUNT_NOT_FOUND", 404);
    assertMaintenanceTransition(current, data);
    if (!data.isActive) await protectLastAdministrator(tx, id);
    const [updated] = await tx.$queryRaw<Account[]>`UPDATE sports_management.users u
      SET is_active=${data.isActive}, maintenance_revision=maintenance_revision+1, version=version+1
      WHERE u.id=${id}::uuid RETURNING ${selection}`;
    // También al reactivar: ninguna sesión anterior debe revivir.
    await tx.sessions.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date() } });
    await tx.audit_logs.create({ data: { user_id: actor.id, action: "UPDATE", table_name: "users", entity_id: id,
      previous_data: { is_active: current.isActive, maintenance_revision: current.revision },
      new_data: { is_active: updated.isActive, maintenance_revision: updated.revision }, reason: data.reason } });
    return updated;
  });
}
