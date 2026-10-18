import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import {
  assertPermission, AuthorizationError, isAuthorityPermissionModule, lockAuthorization, permissionActions,
} from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { permissionAssignmentSchema, permissionRoleFilterSchema } from "../schemas";

export class PermissionAdministrationError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "INVALID_CATALOG_ENTRY" | "LAST_PERMISSION_MANAGER",
    public readonly status = 400,
  ) { super(code); }
}

/**
 * Los vínculos afectan a TODOS los usuarios del rol. Por eso su administración
 * requiere autoridad global, incluso si el vínculo solicitado es context_only.
 */
export async function getPermissionAssignments(roleCode?: string) {
  const actor = await requireOperationalUser();
  const filter = permissionRoleFilterSchema.safeParse(roleCode);
  if (!filter.success) throw new PermissionAdministrationError("VALIDATION_ERROR");
  return getPrisma().$transaction(async (tx) => {
    await assertPermission(tx, actor.id, { module: "users", action: "READ", context: {} });
    const roles = await tx.roles.findMany({
      where: filter.data ? { code: filter.data } : undefined,
      select: { id: true, code: true, name: true }, orderBy: { code: "asc" },
    });
    if (filter.data && !roles.length) throw new PermissionAdministrationError("INVALID_CATALOG_ENTRY");
    const permissions = await tx.permissions.findMany({
      select: { id: true, module: true, action: true }, orderBy: [{ module: "asc" }, { action: "asc" }],
    });
    const assignments = await tx.role_permissions.findMany({
      where: filter.data ? { role_id: { in: roles.map((role) => role.id) } } : undefined,
      select: { id: true, role_id: true, permission_id: true, context_only: true },
      orderBy: [{ role_id: "asc" }, { permission_id: "asc" }],
    });
    const codes = new Map(roles.map((role) => [role.id, role.code]));
    return {
      roles: roles.map(({ code, name }) => ({ code, name })), permissions,
      assignments: assignments.map((assignment) => ({
        id: assignment.id, roleCode: codes.get(assignment.role_id)!,
        permissionId: assignment.permission_id, contextOnly: assignment.context_only,
      })),
    };
  });
}

/** Se evalúa después de la escritura y antes del commit bajo el bloqueo de política. */
async function assertOperationalManagerRemains(tx: Prisma.TransactionClient) {
  const managers = await tx.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM sports_management.users u
    WHERE u.is_active AND NOT u.must_change_password
      AND (u.locked_until IS NULL OR u.locked_until <= clock_timestamp())
      AND EXISTS (
        SELECT 1 FROM sports_management.user_roles ur
        JOIN sports_management.role_permissions rp ON rp.role_id = ur.role_id
        JOIN sports_management.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = u.id AND ur.league_id IS NULL AND ur.club_id IS NULL
          AND ur.starts_at <= clock_timestamp() AND ur.ends_at IS NULL
          AND NOT rp.context_only AND p.module = 'users' AND p.action = 'READ'
      )
      AND EXISTS (
        SELECT 1 FROM sports_management.user_roles ur
        JOIN sports_management.role_permissions rp ON rp.role_id = ur.role_id
        JOIN sports_management.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = u.id AND ur.league_id IS NULL AND ur.club_id IS NULL
          AND ur.starts_at <= clock_timestamp() AND ur.ends_at IS NULL
          AND NOT rp.context_only AND p.module = 'users' AND p.action = 'UPDATE'
      )
    FOR SHARE OF u
  `;
  if (!managers.length) throw new PermissionAdministrationError("LAST_PERMISSION_MANAGER", 409);
}

export async function changePermissionAssignment(input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = permissionAssignmentSchema.safeParse(input);
  if (!parsed.success) throw new PermissionAdministrationError("VALIDATION_ERROR");
  const data = parsed.data;
  return getPrisma().$transaction(async (tx) => {
    // Antes de cualquier guard compartido: evita promociones de bloqueo y
    // serializa dos revocaciones que, vistas por separado, dejarían un gestor.
    await lockAuthorization(tx, "exclusive");
    const managers = await assertPermission(tx, actor.id, { module: "users", action: "UPDATE", context: {} });
    // El esquema no expresa caducidad en role_permissions. Una delegación
    // temporal no puede producir una modificación permanente de la política.
    if (!managers.some((grant) => grant.endsAt === null)) throw new AuthorizationError();
    const role = await tx.roles.findUnique({ where: { code: data.roleCode }, select: { id: true } });
    const permission = await tx.permissions.findUnique({
      where: { id: data.permissionId }, select: { id: true, module: true, action: true },
    });
    if (!role || !permission) throw new PermissionAdministrationError("INVALID_CATALOG_ENTRY");
    const action = z.enum(permissionActions).safeParse(permission.action);
    if (!action.success) throw new PermissionAdministrationError("INVALID_CATALOG_ENTRY");

    if (data.granted) {
      // Administrar una política y ejecutar su operación son capacidades
      // distintas. APPROVE permite administrar concesiones operativas, pero
      // ninguna aprobación permite fabricar autoridad de cuentas o permisos.
      let holdsPermission = false;
      try {
        const backing = await assertPermission(tx, actor.id, {
          module: permission.module, action: action.data, context: {},
        });
        holdsPermission = backing.some((grant) => grant.endsAt === null);
      } catch (error) {
        if (!(error instanceof AuthorizationError)) throw error;
      }
      if (!holdsPermission) {
        if (isAuthorityPermissionModule(permission.module)) throw new AuthorizationError();
        const approval = await assertPermission(tx, actor.id, {
          module: "users", action: "APPROVE", context: {},
        });
        if (!approval.some((grant) => grant.endsAt === null)) throw new AuthorizationError();
      }
    }
    const previous = await tx.role_permissions.findUnique({
      where: { role_id_permission_id: { role_id: role.id, permission_id: permission.id } },
      select: { id: true, context_only: true },
    });
    const changed = data.granted ? !previous || previous.context_only !== data.contextOnly : !!previous;
    if (!changed) return { roleCode: data.roleCode, permissionId: permission.id, granted: data.granted, changed: false };

    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${data.reason}, true)`;
    if (data.granted) {
      await tx.role_permissions.upsert({
        where: { role_id_permission_id: { role_id: role.id, permission_id: permission.id } },
        create: { role_id: role.id, permission_id: permission.id, context_only: data.contextOnly },
        update: { context_only: data.contextOnly },
      });
    } else {
      await tx.role_permissions.delete({ where: { id: previous!.id } });
    }
    // El trigger record_audit del baseline conserva actor, motivo y estado
    // anterior/nuevo, y se revierte junto con el vínculo ante cualquier error.
    await assertOperationalManagerRemains(tx);
    return { roleCode: data.roleCode, permissionId: permission.id, granted: data.granted, changed: true };
  }, { timeout: 15_000 });
}
