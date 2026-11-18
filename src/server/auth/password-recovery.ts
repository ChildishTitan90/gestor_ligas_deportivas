import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import type { EmailTransport } from "@/server/email/transport";
import { lockAuthUser } from "./lock-user";
import { hashPassword } from "./password";

function tokenHash(token: string) {
  return createHash("sha256").update("PDGLD-32:").update(token).digest("hex");
}

export function recoveryPolicy(env: Record<string, string | undefined> = process.env) {
  const minutes = env.PASSWORD_RECOVERY_TTL_MINUTES ?? "";
  const limit = env.PASSWORD_RECOVERY_MAX_PER_HOUR ?? "";
  if (env.PASSWORD_RECOVERY_ENABLED !== "true" || !/^[1-9][0-9]?$/.test(minutes) ||
      Number(minutes) > 60 || !/^[1-9][0-9]?$/.test(limit)) return null;
  return { ttlMs: Number(minutes) * 60_000, maxPerHour: Number(limit) };
}

export async function requestPasswordRecovery(email: string, transport: EmailTransport, policy: NonNullable<ReturnType<typeof recoveryPolicy>>) {
  const token = randomBytes(32).toString("base64url");
  const message = await getPrisma().$transaction(async tx => {
    // El adaptador envía fechas UTC sin offset; fija la zona solo en esta transacción.
    await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
    const candidates = await tx.users.findMany({ where: { email: { in: [email], mode: "insensitive" } }, select: { id: true }, take: 2 });
    if (candidates.length !== 1) return null;
    const id = candidates[0].id;
    if (!await lockAuthUser(tx, id)) return null;
    const user = await tx.users.findUnique({ where: { id }, select: { email: true, is_active: true, email_verified_at: true } });
    if (!user?.is_active || !user.email_verified_at || user.email.toLowerCase() !== email) return null;

    const now = new Date();
    // Serialize issuance per account. A request without proof of ownership cannot
    // invalidate the recipient's still usable link.
    const active = await tx.password_resets.findFirst({ where: { user_id: id, used_at: null, expires_at: { gt: now } }, select: { id: true } });
    if (active) return null;
    const count = await tx.password_resets.count({ where: { user_id: id, created_at: { gte: new Date(now.getTime() - 3_600_000) } } });
    if (count >= policy.maxPerHour) return null;
    const operationId = randomUUID();
    const expiresAt = new Date(now.getTime() + policy.ttlMs);
    await tx.password_resets.create({ data: { id: operationId, user_id: id, token_hash: tokenHash(token), created_at: now, expires_at: expiresAt }, select: { id: true } });
    return { kind: "PASSWORD_RECOVERY" as const, to: user.email, token, expiresAt, idempotencyKey: operationId, userId: id };
  });
  if (message) {
    const { userId, ...emailMessage } = message;
    const outcome = await transport.send(emailMessage);
    if (outcome === "FAILED") {
      // Only a confirmed rejection makes this particular link unusable.
      // Preserve uncertain deliveries and the hourly issuance count.
      await getPrisma().$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        if (!await lockAuthUser(tx, userId)) return;
        await tx.password_resets.updateMany({
          where: { id: message.idempotencyKey, token_hash: tokenHash(message.token), used_at: null },
          data: { used_at: new Date() },
        });
      });
    }
    if (outcome !== "ACCEPTED") console.warn("[auth] PASSWORD_RECOVERY_DELIVERY_UNCONFIRMED");
  }
}

export function invalidatePasswordRecovery(tx: Prisma.TransactionClient, userId: string, now: Date) {
  return tx.password_resets.updateMany({ where: { user_id: userId, used_at: null }, data: { used_at: now } });
}

export async function completePasswordRecovery(token: string, newPassword: string) {
  return getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
    const reset = await tx.password_resets.findUnique({ where: { token_hash: tokenHash(token) }, select: { id: true, user_id: true, expires_at: true, used_at: true } });
    if (!reset || reset.used_at || reset.expires_at <= new Date()) return false;
    const user = await lockAuthUser(tx, reset.user_id);
    if (!user?.is_active) return false;
    // Re-read after obtaining the account lock: reset, email change or another
    // consumption may have invalidated the token while we waited.
    const current = await tx.password_resets.findUnique({ where: { id: reset.id }, select: { used_at: true, expires_at: true } });
    if (!current || current.used_at || current.expires_at <= new Date()) return false;
    const password_hash = await hashPassword(newPassword);
    const now = new Date();
    const claim = await tx.password_resets.updateMany({ where: { id: reset.id, used_at: null, expires_at: { gt: now } }, data: { used_at: now } });
    if (claim.count !== 1) return false;
    await tx.users.update({ where: { id: user.id }, data: { password_hash, must_change_password: false,
      admin_reset_expires_at: null, admin_reset_consumed_at: null, failed_login_attempts: 0,
      locked_until: null, version: { increment: 1 }, maintenance_revision: { increment: 1 } }, select: { id: true } });
    await invalidatePasswordRecovery(tx, user.id, now);
    await tx.sessions.updateMany({ where: { user_id: user.id, revoked_at: null }, data: { revoked_at: now } });
    await tx.authentication_events.create({ data: { user_id: user.id, action: "PASSWORD_CHANGED", occurred_at: now }, select: { id: true } });
    return true;
  });
}
