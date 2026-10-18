import "server-only";

import { loginSchema } from "@/features/auth/schemas";
import { getPrisma } from "@/server/db/prisma";
import { lockAuthUser } from "./lock-user";
import { verifyPassword } from "./password";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export async function authorizeCredentials(input: unknown) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return null;

  try {
    const prisma = getPrisma();
    const identity = await prisma.users.findFirst({
      where: {
        // Comparación literal: no interpretar _ y % como comodines de ILIKE.
        email: { in: [parsed.data.email], mode: "insensitive" },
      },
      select: { id: true },
    });

    if (!identity) {
      await verifyPassword(null, parsed.data.password);
      return null;
    }

    return await prisma.$transaction(async (tx) => {
      // Leer tras obtener el bloqueo: otro intento o cambio de contraseña
      // puede haber modificado la cuenta mientras esta petición esperaba.
      const user = await lockAuthUser(tx, identity.id);
      const now = new Date();
      if (!user || !user.is_active || (user.locked_until && user.locked_until > now)) {
        await verifyPassword(null, parsed.data.password);
        return null;
      }

      const baseAttempts = user.locked_until ? 0 : user.failed_login_attempts;
      const valid = await verifyPassword(user.password_hash, parsed.data.password);

      if (!valid) {
        const nextAttempts = baseAttempts + 1;
        await tx.users.update({
          where: { id: user.id },
          data: {
            failed_login_attempts: nextAttempts,
            locked_until: nextAttempts >= MAX_FAILED_ATTEMPTS
              ? new Date(Date.now() + LOCK_DURATION_MS) : null,
          },
        });
        return null;
      }

      if (user.failed_login_attempts > 0 || user.locked_until !== null) {
        await tx.users.update({
          where: { id: user.id },
          data: { failed_login_attempts: 0, locked_until: null },
        });
      }

      return { id: user.id, mustChangePassword: user.must_change_password, userVersion: user.version };
    });
  } catch {
    // No propagar errores Prisma: NextAuth puede incluir el mensaje en la URL.
    console.error("[auth] CREDENTIALS_UNAVAILABLE");
    return null;
  }
}
