import { z } from "zod";
import { usernameSchema } from "@/features/auth/schemas";

export const accountListSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(100).default(""),
});
export const accountStatusSchema = z.strictObject({
  isActive: z.boolean(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  reason: z.string().trim().min(10).max(300),
  confirmed: z.literal(true),
});
export const accountIdentifiersSchema = z.strictObject({
  changes: z.strictObject({ username: usernameSchema }),
  expectedRevision: accountStatusSchema.shape.expectedRevision,
  confirmed: accountStatusSchema.shape.confirmed,
  reason: accountStatusSchema.shape.reason,
});

export function accountIdentifierChanges(current: { username: string; email: string; revision: number },
  desired: z.infer<typeof accountIdentifiersSchema>) {
  if (current.revision !== desired.expectedRevision) throw new AccountMaintenanceError("ACCOUNT_CHANGED", 409);
  const next = { username: desired.changes.username ?? current.username, email: current.email };
  const changedFields = (["username"] as const).filter(field => next[field] !== current[field]);
  if (!changedFields.length) throw new AccountMaintenanceError("ACCOUNT_IDENTIFIERS_UNCHANGED", 409);
  return { ...next, changedFields };
}

/** SQLSTATE y nombre exacto: pg y metadatos/causas del adaptador Prisma 7. */
export function isAccountIdentifierConflict(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length && seen.size < 16) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const node = value as Record<string, unknown>;
    const code = node.originalCode ?? node.code;
    const message = node.originalMessage ?? node.message;
    if (code === "23505" && ["users_username_unique", "users_email_unique"].some(name =>
      node.constraint === name || (typeof message === "string" && (message === name || message.includes(`"${name}"`))))) return true;
    pending.push(node.meta, node.cause, node.driverAdapterError);
  }
  return false;
}
export class AccountMaintenanceError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export type AdministratorAvailability = {
  active: boolean; currentAssignment: boolean; globalRead: boolean; globalUpdate: boolean;
  temporarilyBlocked: boolean; mustChangePassword: boolean;
};
/** Solo otra cuenta operativa cuenta como respaldo, según la decisión de Sergio. */
export function assertAdministratorReplacement(others: readonly AdministratorAvailability[]) {
  const assigned = others.filter(a => a.active && a.currentAssignment);
  if (!assigned.length) throw new AccountMaintenanceError("LAST_ACTIVE_SUPERADMIN", 409);
  const effective = assigned.filter(a => a.globalRead && a.globalUpdate);
  if (!effective.length) throw new AccountMaintenanceError("LAST_EFFECTIVE_SUPERADMIN", 409);
  if (!effective.some(a => !a.temporarilyBlocked && !a.mustChangePassword))
    throw new AccountMaintenanceError("LAST_OPERATIONAL_SUPERADMIN", 409);
}
export function assertMaintenanceTransition(current: { isActive: boolean; revision: number }, desired: {
  isActive: boolean; expectedRevision: number;
}) {
  if (current.revision !== desired.expectedRevision) throw new AccountMaintenanceError("ACCOUNT_CHANGED", 409);
  if (current.isActive === desired.isActive) throw new AccountMaintenanceError("ACCOUNT_STATE_UNCHANGED", 409);
}
