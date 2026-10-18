import "server-only";
import type { Prisma } from "@prisma/client";

export class AccountAccessError extends Error {
  readonly status = 403;
  constructor() { super("FORBIDDEN"); }
}

/** Regla explícita de HU22-01; no sustituye la matriz general de PDGLD-35. */
export async function assertAccountAdministrator(tx: Prisma.TransactionClient, actorId: string) {
  // Mantener cuenta y concesión estables mientras se realiza la operación.
  const users = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM sports_management.users
    WHERE id = ${actorId}::uuid AND is_active AND NOT must_change_password
      AND (locked_until IS NULL OR locked_until <= clock_timestamp())
    FOR SHARE
  `;
  if (!users.length) throw new AccountAccessError();
  const grants = await tx.$queryRaw<{ id: string }[]>`
    SELECT ur.id FROM sports_management.user_roles ur
    JOIN sports_management.roles r ON r.id = ur.role_id
    WHERE ur.user_id = ${actorId}::uuid AND r.code = 'SUPERADMIN'
      AND ur.league_id IS NULL AND ur.club_id IS NULL
      AND ur.starts_at <= clock_timestamp()
      AND (ur.ends_at IS NULL OR ur.ends_at > clock_timestamp())
    FOR SHARE OF ur, r
  `;
  if (!grants.length) throw new AccountAccessError();
}


