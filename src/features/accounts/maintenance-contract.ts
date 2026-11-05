import { z } from "zod";

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
export class AccountMaintenanceError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export type AdministratorAvailability = {
  active: boolean; currentAssignment: boolean; globalRead: boolean; globalUpdate: boolean;
  temporarilyBlocked: boolean; mustChangePassword: boolean;
};
/** No convertir un bloqueo temporal en una decisión definitiva sobre el último administrador. */
export function assertAdministratorReplacement(others: readonly AdministratorAvailability[]) {
  const assigned = others.filter(a => a.active && a.currentAssignment);
  if (!assigned.length) throw new AccountMaintenanceError("LAST_ACTIVE_SUPERADMIN", 409);
  const effective = assigned.filter(a => a.globalRead && a.globalUpdate);
  if (!effective.length) throw new AccountMaintenanceError("LAST_EFFECTIVE_SUPERADMIN", 409);
  if (!effective.some(a => !a.temporarilyBlocked && !a.mustChangePassword))
    throw new AccountMaintenanceError("SUPERADMIN_AVAILABILITY_DECISION_REQUIRED", 409);
}
export function assertMaintenanceTransition(current: { isActive: boolean; revision: number }, desired: {
  isActive: boolean; expectedRevision: number;
}) {
  if (current.revision !== desired.expectedRevision) throw new AccountMaintenanceError("ACCOUNT_CHANGED", 409);
  if (current.isActive === desired.isActive) throw new AccountMaintenanceError("ACCOUNT_STATE_UNCHANGED", 409);
}
