import "server-only";

import type { JWT } from "next-auth/jwt";
import { z } from "zod";
import { validatePersistentSession } from "./session-store";

const identityTokenSchema = z.object({
  sub: z.uuid(),
  userVersion: z.number().int().positive(),
  mustChangePassword: z.boolean(),
  sid: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export async function refreshIdentityToken(token: JWT): Promise<JWT> {
  const parsed = identityTokenSchema.safeParse(token);

  if (!parsed.success) return {};

  try {
    const identity = parsed.data;

    const session = await validatePersistentSession(
      identity.sid,
      identity.sub,
      identity.userVersion,
    );

    if (!session) return {};

    return {
      sub: session.userId,
      userVersion: session.userVersion,

      // Una sesión nacida restringida requiere iniciar sesión
      // nuevamente después del cambio de contraseña.
      mustChangePassword:
        identity.mustChangePassword || session.mustChangePassword,

      // Identificador estable, independiente del jti de NextAuth.
      sid: identity.sid,

      idleExpiresAt: session.expiresAt.toISOString(),
    };
  } catch {
    // No registrar tokens, conexiones ni errores del driver.
    console.error("[auth] SESSION_UNAVAILABLE");
    return {};
  }
}