import "server-only";

import { loginSchema } from "@/features/auth/schemas";
import { getPrisma } from "@/server/db/prisma";
import { lockAuthUser } from "./lock-user";
import { getLoginPolicy } from "./login-policy";
import { verifyPassword } from "./password";

export async function authorizeCredentials(input: unknown) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return null;

  try {
    const policy = getLoginPolicy();
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
      // La FK admite NULL. No almacenar correo ni inventar una cuenta para auditar.
      await prisma.authentication_events.create({ data: { action: "LOGIN_FAILED" } });
      return null;
    }

    return await prisma.$transaction(async (tx) => {
      // Leer tras obtener el bloqueo: otro intento o cambio de contraseña
      // puede haber modificado la cuenta mientras esta petición esperaba.
      const user = await lockAuthUser(tx, identity.id);
      const now = new Date();
      if (!user) {
        await verifyPassword(null, parsed.data.password);
        await tx.authentication_events.create({ data: { action: "LOGIN_FAILED", occurred_at: now } });
        return null;
      }
      if (!user.is_active || (user.locked_until && user.locked_until > now)) {
        await verifyPassword(null, parsed.data.password);
        await tx.authentication_events.create({ data: { user_id: user.id, action: "LOGIN_FAILED", occurred_at: now } });
        return null;
      }

      const baseAttempts = user.locked_until ? 0 : user.failed_login_attempts;
      const valid = await verifyPassword(user.password_hash, parsed.data.password);

      if (!valid) {
        const nextAttempts = baseAttempts + 1;
        const blocking = nextAttempts >= policy.maxFailedAttempts;
        await tx.users.update({
          where: { id: user.id },
          data: {
            failed_login_attempts: nextAttempts,
            locked_until: blocking ? new Date(now.getTime() + policy.lockoutMs) : null,
          },
        });
        await tx.authentication_events.create({ data: { user_id: user.id, action: "LOGIN_FAILED", occurred_at: now } });
        // El bloqueo de cuenta serializa esta transición. Los intentos durante
        // el bloqueo pasan por la rama anterior y no repiten BLOCK ni lo extienden.
        if (blocking)
          await tx.authentication_events.create({ data: { user_id: user.id, action: "BLOCK", occurred_at: now } });
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
