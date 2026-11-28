import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import type {
  TwoFactorCommand,
  TwoFactorResult,
} from "@/features/auth/two-factor-contract";
import { lockAuthUser } from "./lock-user";
import { lockAuthorization } from "./authorization";
import { verifyPassword } from "./password";
import { getIdleTimeoutMs, isSessionExpired } from "./idle-policy";
import { hashSessionKey } from "./persistent-session";
import {
  MFA_PENDING_MS,
  matchTotp,
  mfaFailure,
  newMfaSecret,
  newRecoveryCodes,
  openMfaSecret,
  recoveryCodeHash,
  sealMfaSecret,
} from "./two-factor-crypto";

export type MfaIdentity = { id: string; userVersion: number; sid: string };
const result = (code: string, status = 200): TwoFactorResult => ({
  code,
  status,
});
export async function mfaEligible(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const grants = await tx.$queryRaw<{ id: string }[]>`
    SELECT ur.id FROM sports_management.user_roles ur JOIN sports_management.roles r ON r.id=ur.role_id
    WHERE ur.user_id=${userId}::uuid AND r.code IN ('SUPERADMIN','EXECUTIVE_PRESIDENT','DISCIPLINARY_BOARD')
      AND ur.starts_at<=clock_timestamp() AND (ur.ends_at IS NULL OR ur.ends_at>clock_timestamp())
      AND (ur.league_id IS NULL OR EXISTS(SELECT 1 FROM sports_management.leagues l WHERE l.id=ur.league_id AND l.is_active))
      AND (ur.club_id IS NULL OR EXISTS(SELECT 1 FROM sports_management.clubs c JOIN sports_management.leagues l ON l.id=c.league_id
        WHERE c.id=ur.club_id AND c.status='ACTIVE' AND l.is_active AND (ur.league_id IS NULL OR ur.league_id=c.league_id)))
    FOR SHARE OF ur,r`;
  return grants.length > 0;
}
/** The caller must derive identity from a revalidated HttpOnly session, never request JSON. */
export async function executeTwoFactor(
  identity: MfaIdentity,
  command: TwoFactorCommand,
): Promise<TwoFactorResult> {
  return getPrisma().$transaction(
    async (tx) => {
      await lockAuthorization(tx);
      const user = await lockAuthUser(tx, identity.id);
      const now = new Date(),
        sessionHash = hashSessionKey(identity.sid);
      if (
        !user ||
        !user.is_active ||
        user.version !== identity.userVersion ||
        (user.locked_until && user.locked_until > now)
      )
        return result("UNAUTHENTICATED", 401);
      await tx.$queryRaw`SELECT id FROM sports_management.sessions WHERE token_hash = ${sessionHash} FOR UPDATE`;
      const session = await tx.sessions.findUnique({
        where: { token_hash: sessionHash },
      });
      if (
        !session ||
        session.user_id !== user.id ||
        isSessionExpired(session, now, getIdleTimeoutMs()) ||
        (user.admin_reset_expires_at && user.admin_reset_expires_at <= now) ||
        (session.mfa_state !== "VERIFIED" &&
          (!session.mfa_expires_at || session.mfa_expires_at <= now))
      )
        return result("UNAUTHENTICATED", 401);
      // A mandatory password change never bypasses a configured second factor.
      if (session.mfa_state === "VERIFIED" && user.must_change_password)
        return result("PASSWORD_CHANGE_REQUIRED", 403);
      const eligible = await mfaEligible(tx, user.id);
      let factor = await tx.mfa_factors.findUnique({
        where: { user_id: user.id },
      });
      if (command.action === "status")
        return {
          ...result("STATUS"),
          revision: factor?.revision ?? 0,
          active: !!factor?.encrypted_secret,
          eligible,
          pending:
            !!factor?.pending_expires_at &&
            factor.pending_expires_at > now &&
            factor.pending_session_hash === sessionHash,
          expiresAt: (session.mfa_state !== "VERIFIED"
            ? session.mfa_expires_at
            : factor?.pending_expires_at
          )?.toISOString(),
          remainingCodes: await tx.mfa_recovery_codes.count({
            where: { user_id: user.id, consumed_at: null },
          }),
        };
      if (
        session.mfa_state === "PENDING" &&
        !["verify", "recover"].includes(command.action)
      )
        return result("MFA_REQUIRED", 403);
      if (
        session.mfa_state === "RECOVERY" &&
        !["confirm", "cancel"].includes(command.action)
      )
        return result("RECOVERY_RESTRICTED", 403);
      if (
        session.mfa_state === "VERIFIED" &&
        ["verify", "recover"].includes(command.action)
      )
        return result("CONFLICT", 409);
      if (!eligible && !["verify", "recover"].includes(command.action))
        return result("FORBIDDEN", 403);
      // Creating or cancelling an enrollment never resets attempts or the account-wide block.
      if (!factor)
        factor = await tx.mfa_factors.create({ data: { user_id: user.id } });
      if ("revision" in command && command.revision !== factor.revision)
        return result("CONFLICT", 409);
      if (factor.blocked_until && factor.blocked_until > now)
        return {
          ...result("MFA_BLOCKED", 429),
          retryAt: factor.blocked_until.toISOString(),
        };
      const event = async (action: string) => {
        await tx.authentication_events.create({
          data: { user_id: user.id, action, occurred_at: now },
        });
      };
      const failure = async () => {
        const next = mfaFailure(
          factor.failed_attempts,
          factor.blocked_until,
          now,
        );
        await tx.mfa_factors.update({
          where: { user_id: user.id },
          data: {
            failed_attempts: next.attempts,
            blocked_until: next.blockedUntil,
          },
        });
        await event(next.blockedUntil ? "MFA_BLOCKED" : "MFA_FAILED");
        return {
          ...result(
            next.blockedUntil ? "MFA_BLOCKED" : "INVALID_PROOF",
            next.blockedUntil ? 429 : 400,
          ),
          ...(next.blockedUntil
            ? { retryAt: next.blockedUntil.toISOString() }
            : {}),
        };
      };
      const prove = async (proof: {
        method: "totp" | "backup";
        code: string;
      }) => {
        if (!factor.encrypted_secret) return false;
        if (proof.method === "totp") {
          const step = matchTotp(
            openMfaSecret(factor.encrypted_secret, `${user.id}:active`),
            proof.code,
            now,
            factor.last_step,
          );
          if (step === null) return false;
          await tx.mfa_factors.update({
            where: { user_id: user.id },
            data: { last_step: step },
          });
          return true;
        }
        const changed = await tx.mfa_recovery_codes.updateMany({
          where: {
            user_id: user.id,
            code_hash: recoveryCodeHash(user.id, proof.code),
            consumed_at: null,
          },
          data: { consumed_at: now },
        });
        return changed.count === 1;
      };
      const reset = async () => {
        await tx.mfa_factors.update({
          where: { user_id: user.id },
          data: { failed_attempts: 0, blocked_until: null },
        });
      };
      const pendingClear = {
        pending_secret: null,
        pending_id: null,
        pending_expires_at: null,
        pending_session_hash: null,
      };
      const revoke = async () => {
        await tx.users.update({
          where: { id: user.id },
          data: { version: { increment: 1 } },
        });
        await tx.sessions.updateMany({
          where: { user_id: user.id, revoked_at: null },
          data: { revoked_at: now },
        });
      };
      const begin = async (
        deadline = new Date(now.getTime() + MFA_PENDING_MS),
      ) => {
        const secret = newMfaSecret();
        const operation = randomUUID();
        const effectiveExpiry = new Date(
          Math.min(deadline.getTime(), session.expires_at.getTime()),
        );
        const updated = await tx.mfa_factors.update({
          where: { user_id: user.id },
          data: {
            pending_secret: sealMfaSecret(
              secret,
              `${user.id}:pending:${operation}`,
            ),
            pending_id: operation,
            pending_expires_at: effectiveExpiry,
            pending_session_hash: sessionHash,
            revision: { increment: 1 },
          },
        });
        // No email or personal name in the provisioning URI.
        const uri = `otpauth://totp/${encodeURIComponent(`Gestor:${user.username.includes("@") ? user.id : user.username}`)}?secret=${secret}&issuer=Gestor&algorithm=SHA1&digits=6&period=30`;
        return {
          ...result("ENROLLMENT_PENDING"),
          operation,
          secret,
          uri,
          revision: updated.revision,
          expiresAt: effectiveExpiry.toISOString(),
        };
      };
      if (command.action === "verify") {
        if (!(await prove({ method: "totp", code: command.code })))
          return failure();
        const expiresAt = new Date(
          Math.min(
            now.getTime() + getIdleTimeoutMs(),
            user.admin_reset_expires_at?.getTime() ?? Infinity,
          ),
        );
        await reset();
        await tx.sessions.update({
          where: { id: session.id },
          data: {
            mfa_state: "VERIFIED",
            mfa_expires_at: null,
            last_activity_at: now,
            expires_at: expiresAt,
          },
        });
        await event("MFA_VERIFIED");
        await event("LOGIN_OK");
        return result("VERIFIED");
      }
      if (command.action === "recover") {
        // Consumption grants no operational access, only a ten-minute replacement ceremony.
        if (!eligible) return result("FORBIDDEN", 403);
        if (!(await prove({ method: "backup", code: command.code })))
          return failure();
        await reset();
        const recoveryDeadline = new Date(
          Math.min(
            session.mfa_expires_at!.getTime(),
            now.getTime() + MFA_PENDING_MS,
          ),
        );
        await tx.sessions.update({
          where: { id: session.id },
          data: { mfa_state: "RECOVERY", mfa_expires_at: recoveryDeadline },
        });
        await event("MFA_RECOVERY_STARTED");
        return begin(recoveryDeadline);
      }
      if (command.action === "begin" || command.action === "disable") {
        if (!(await verifyPassword(user.password_hash, command.password)))
          return failure();
        if (
          factor.encrypted_secret &&
          (!command.proof || !(await prove(command.proof)))
        )
          return failure();
        if (command.action === "disable") {
          if (!factor.encrypted_secret) return result("CONFLICT", 409);
          await tx.mfa_factors.update({
            where: { user_id: user.id },
            data: {
              ...pendingClear,
              encrypted_secret: null,
              last_step: null,
              revision: { increment: 1 },
              failed_attempts: 0,
              blocked_until: null,
            },
          });
          await tx.mfa_recovery_codes.updateMany({
            where: { user_id: user.id, consumed_at: null },
            data: { consumed_at: now },
          });
          await revoke();
          await event("MFA_DISABLED");
          return result("REAUTHENTICATE");
        }
        await reset();
        return begin();
      }
      if (
        !factor.pending_secret ||
        factor.pending_id !== command.operation ||
        factor.pending_session_hash !== sessionHash ||
        !factor.pending_expires_at ||
        factor.pending_expires_at <= now
      )
        return result("ENROLLMENT_EXPIRED", 409);
      if (command.action === "cancel") {
        await tx.mfa_factors.update({
          where: { user_id: user.id },
          data: { ...pendingClear, revision: { increment: 1 } },
        });
        if (session.mfa_state === "RECOVERY")
          await tx.sessions.update({
            where: { id: session.id },
            data: { revoked_at: now },
          });
        return result(
          session.mfa_state === "RECOVERY" ? "REAUTHENTICATE" : "CANCELLED",
        );
      }
      const secret = openMfaSecret(
        factor.pending_secret,
        `${user.id}:pending:${factor.pending_id}`,
      );
      const step = matchTotp(secret, command.code, now, null);
      if (step === null) return failure();
      const backup = newRecoveryCodes(user.id);
      await tx.mfa_factors.update({
        where: { user_id: user.id },
        data: {
          ...pendingClear,
          encrypted_secret: sealMfaSecret(secret, `${user.id}:active`),
          last_step: step,
          revision: { increment: 1 },
          failed_attempts: 0,
          blocked_until: null,
        },
      });
      await tx.mfa_recovery_codes.updateMany({
        where: { user_id: user.id, consumed_at: null },
        data: { consumed_at: now },
      });
      await tx.mfa_recovery_codes.createMany({
        data: backup.hashes.map((code_hash) => ({
          user_id: user.id,
          code_hash,
        })),
      });
      await revoke();
      await event(
        session.mfa_state === "RECOVERY"
          ? "MFA_RECOVERED"
          : factor.encrypted_secret
            ? "MFA_CHANGED"
            : "MFA_ENABLED",
      );
      return { ...result("REAUTHENTICATE"), codes: backup.codes };
    },
    { timeout: 15000 },
  );
}
