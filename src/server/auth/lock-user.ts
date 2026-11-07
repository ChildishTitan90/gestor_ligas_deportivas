import "server-only";

import type { Prisma } from "@prisma/client";

/** Serializa intentos y cambios de contraseña sobre la misma cuenta. */
export async function lockAuthUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`
    SELECT id FROM sports_management.users WHERE id = ${userId}::uuid FOR UPDATE
  `;

  return tx.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      password_hash: true,
      admin_reset_expires_at: true,
      admin_reset_consumed_at: true,
      is_active: true,
      must_change_password: true,
      failed_login_attempts: true,
      locked_until: true,
      version: true,
    },
  });
}
