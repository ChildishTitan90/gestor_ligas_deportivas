import { randomBytes } from "node:crypto";

export const administrativeCredentialLifetimeMs = 30 * 60_000;

export function generateAdministrativeCredential() {
  return randomBytes(32).toString("base64url");
}

export function canUseAdministrativeCredential(user: {
  admin_reset_expires_at: Date | null;
  admin_reset_consumed_at: Date | null;
}, now: Date): boolean {
  return user.admin_reset_expires_at === null ||
    (user.admin_reset_consumed_at === null && user.admin_reset_expires_at > now);
}
