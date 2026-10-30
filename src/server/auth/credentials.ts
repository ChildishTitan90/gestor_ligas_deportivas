import "server-only";

import { loginSchema } from "@/features/auth/schemas";
import { getPrisma } from "@/server/db/prisma";
import { lockAuthUser } from "./lock-user";
import { getLoginPolicy } from "./login-policy";
import { verifyPassword } from "./password";
import { loginLockoutCode } from "@/features/auth/login-feedback";

class LoginTemporarilyLockedError extends Error {}
type CredentialResult = { id: string; mustChangePassword: boolean; userVersion: number } | { blockedUntil: Date } | null;

export async function authorizeCredentials(input: unknown) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return null;

  try {
    const policy = getLoginPolicy();
    const prisma = getPrisma();
    const identities = await prisma.users.findMany({
      where: parsed.data.email.includes("@") ? { OR: [{
        // Comparación literal: no interpretar _ y % como comodines de ILIKE.
        email: { in: [parsed.data.email], mode: "insensitive" },
      }, { username: { in: [parsed.data.email], mode: "insensitive" } }] } : { username: { in: [parsed.data.email], mode: "insensitive" } },
      select: { id: true }, take: 2,
    });

    // Un correo puede coincidir con el username heredado de otra cuenta. No elegir al azar.
    if (identities.length !== 1) {
      await verifyPassword(null, parsed.data.password);
      // La FK admite NULL. No almacenar correo ni inventar una cuenta para auditar.
      await prisma.authentication_events.create({ data: { action: "LOGIN_FAILED" } });
      return null;
    }
    const identity = identities[0];

    const result = await prisma.$transaction<CredentialResult>(async (tx) => {
      // Leer tras obtener el bloqueo: otro intento o cambio de contraseña
      // puede haber modificado la cuenta mientras esta petición esperaba.
      const user = await lockAuthUser(tx, identity.id);
      const now = new Date();
      if (!user) {
        await verifyPassword(null, parsed.data.password);
        await tx.authentication_events.create({ data: { action: "LOGIN_FAILED", occurred_at: now } });
        return null;
      }
      if (!user.is_active) {
        await verifyPassword(null, parsed.data.password);
        await tx.authentication_events.create({ data: { user_id: user.id, action: "LOGIN_FAILED", occurred_at: now } });
        return null;
      }
      if (user.locked_until && user.locked_until > now) {
        await verifyPassword(null, parsed.data.password);
        await tx.authentication_events.create({ data: { user_id: user.id, action: "LOGIN_FAILED", occurred_at: now } });
        return { blockedUntil: user.locked_until };
      }

      const baseAttempts = user.locked_until ? 0 : user.failed_login_attempts;
      const valid = await verifyPassword(user.password_hash, parsed.data.password);

      if (!valid) {
        const nextAttempts = baseAttempts + 1;
        const blocking = nextAttempts >= policy.maxFailedAttempts;
        const blockedUntil = new Date(now.getTime() + policy.lockoutMs);
        await tx.users.update({
          where: { id: user.id },
          data: {
            failed_login_attempts: nextAttempts,
            locked_until: blocking ? blockedUntil : null,
          },
        });
        await tx.authentication_events.create({ data: { user_id: user.id, action: "LOGIN_FAILED", occurred_at: now } });
        // El bloqueo de cuenta serializa esta transición. Los intentos durante
        // el bloqueo pasan por la rama anterior y no repiten BLOCK ni lo extienden.
        if (blocking)
          await tx.authentication_events.create({ data: { user_id: user.id, action: "BLOCK", occurred_at: now } });
        return blocking ? { blockedUntil } : null;
      }

      if (user.failed_login_attempts > 0 || user.locked_until !== null) {
        await tx.users.update({
          where: { id: user.id },
          data: { failed_login_attempts: 0, locked_until: null },
        });
      }

      return { id: user.id, mustChangePassword: user.must_change_password, userVersion: user.version };
    });
    // Comunicar el bloqueo DESPUÉS del commit: lanzar dentro revertiría contador y auditoría.
    if (result && "blockedUntil" in result) {
      throw new LoginTemporarilyLockedError(loginLockoutCode(policy.maxFailedAttempts,
        result.blockedUntil.getTime() - Date.now()));
    }
    return result;
  } catch (error) {
    if (error instanceof LoginTemporarilyLockedError) throw error;
    // No propagar errores Prisma: NextAuth puede incluir el mensaje en la URL.
    console.error("[auth] CREDENTIALS_UNAVAILABLE");
    return null;
  }
}
