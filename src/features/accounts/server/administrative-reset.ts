import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { administrativeResetSchema } from "../administrative-reset-contract";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { hashPassword } from "@/server/auth/password";
import { administrativeCredentialLifetimeMs, generateAdministrativeCredential } from "@/server/auth/administrative-credential";
import { getEmailTransport } from "@/server/email/transport";
import { AccountMaintenanceError } from "../maintenance-contract";
import { protectLastAdministrator } from "./maintenance";

export function resetAccountAccess(id: string, input: unknown) {
  return requireOperationalUser().then(actor =>
    issueAdministrativeCredential(actor.id, id, input, getPrisma(), getEmailTransport()));
}

/** Internal service: actor identity is supplied by the server boundary. */
export async function issueAdministrativeCredential(actorId: string, id: string, input: unknown,
  prisma: ReturnType<typeof getPrisma>, transport: ReturnType<typeof getEmailTransport>) {
  const parsed = administrativeResetSchema.safeParse(input);
  if (!z.uuid().safeParse(id).success || !parsed.success) throw new AccountMaintenanceError("VALIDATION_ERROR");
  const data = parsed.data;
  const temporaryPassword = transport ? generateAdministrativeCredential() : null;
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;
  const operation = await prisma.$transaction(async tx => {
    await lockAuthorization(tx, "exclusive");
    await assertPermission(tx, actorId, { module: "users", action: "UPDATE", context: {} });
    const [target] = await tx.$queryRaw<{ is_active: boolean; email: string; email_verified_at: Date | null; maintenance_revision: number }[]>`
      SELECT is_active, email, email_verified_at, maintenance_revision
      FROM sports_management.users WHERE id=${id}::uuid FOR UPDATE`;
    if (!target) throw new AccountMaintenanceError("ACCOUNT_NOT_FOUND", 404);
    if (actorId === id || !target.is_active) throw new AccountMaintenanceError("RESET_NOT_ALLOWED", 409);
    if (target.maintenance_revision !== data.expectedRevision) throw new AccountMaintenanceError("ACCOUNT_CHANGED", 409);
    if (!target.email_verified_at) throw new AccountMaintenanceError("VERIFIED_CHANNEL_REQUIRED", 409);
    if (!passwordHash) throw new AccountMaintenanceError("NOT_CONFIGURED", 503);
    await protectLastAdministrator(tx, id);
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const now = clock.now;
    const expiresAt = new Date(now.getTime() + administrativeCredentialLifetimeMs);
    await tx.users.update({ where: { id }, data: {
      password_hash: passwordHash, must_change_password: true,
      admin_reset_expires_at: expiresAt, admin_reset_consumed_at: null,
      version: { increment: 1 }, maintenance_revision: { increment: 1 },
      failed_login_attempts: 0, locked_until: null,
    }, select: { id: true } });
    await tx.sessions.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: now } });
    await tx.password_resets.updateMany({ where: { user_id: id, used_at: null }, data: { used_at: now } });
    await tx.$executeRaw`UPDATE sports_management.account_email_changes SET status='SUPERSEDED'
      WHERE user_id=${id}::uuid AND status='PENDING'`;
    const operationId = randomUUID();
    await tx.audit_logs.create({ data: { user_id: actorId, action: "UPDATE", table_name: "users", entity_id: id,
      reason: data.reason, new_data: { operation: "ADMINISTRATIVE_RESET", operation_id: operationId,
        verification_method: data.verificationMethod, sessions_revoked: true, revision: target.maintenance_revision + 1 } } });
    return { operationId, expiresAt, to: target.email, revision: target.maintenance_revision + 1 };
  });
  let delivery: "ACCEPTED" | "FAILED" | "UNKNOWN" = "UNKNOWN";
  // Tras el commit, jamás revertir ni reemitir automáticamente por una respuesta incierta.
  try {
    delivery = await transport!.send({ kind: "ADMINISTRATIVE_RESET", to: operation.to,
      temporaryPassword: temporaryPassword!, expiresAt: operation.expiresAt, idempotencyKey: operation.operationId });
  } catch { /* El proveedor pudo aceptar antes de perder la respuesta. */ }
  return { operationId: operation.operationId, revision: operation.revision,
    expiresAt: operation.expiresAt.toISOString(), delivery };
}
