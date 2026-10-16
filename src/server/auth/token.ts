import "server-only";

import type { JWT } from "next-auth/jwt";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { getIdleTimeoutSeconds } from "./idle-policy";
import { hashSessionKey } from "./persistent-session";

const identityTokenSchema = z.object({
  sub: z.uuid(),
  userVersion: z.number().int().positive(),
  mustChangePassword: z.boolean(),
  sid: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

/** Revalidar estado actual; los campos de update() del navegador no son autoridad. */
export async function refreshIdentityToken(token: JWT, recordActivity = false): Promise<JWT> {
  const parsed = identityTokenSchema.safeParse(token);
  if (!parsed.success) return {};
  try {
    const tokenHash = hashSessionKey(parsed.data.sid);
    return await getPrisma().$transaction(async (tx) => {
      if (recordActivity) {
        // Leer el reloj después del bloqueo evita retroceder la actividad cuando
        // dos pestañas renuevan al mismo tiempo. Nunca revivir una sesión vencida.
        await tx.$queryRaw`
          SELECT id FROM sports_management.sessions WHERE token_hash = ${tokenHash} FOR UPDATE
        `;
      }
      const session = await tx.sessions.findUnique({
        where: { token_hash: tokenHash },
        select: {
          id: true, user_id: true, last_activity_at: true, expires_at: true, revoked_at: true,
          users: { select: { id: true, is_active: true, locked_until: true, must_change_password: true, version: true } },
        },
      });
      const now = new Date();
      const idleMs = getIdleTimeoutSeconds() * 1000;
      if (!session || session.user_id !== parsed.data.sub || session.revoked_at ||
        session.expires_at <= now || session.last_activity_at.getTime() + idleMs <= now.getTime()) return {};
      const user = session.users;
      if (!user.is_active || user.version !== parsed.data.userVersion ||
        (user.locked_until && user.locked_until > now)) return {};

      let expiresAt = new Date(Math.min(session.expires_at.getTime(), session.last_activity_at.getTime() + idleMs));
      if (recordActivity) {
        expiresAt = new Date(now.getTime() + idleMs);
        await tx.sessions.update({
          where: { id: session.id },
          data: { last_activity_at: now, expires_at: expiresAt },
        });
      }
      return {
        sub: user.id,
        userVersion: user.version,
        mustChangePassword: parsed.data.mustChangePassword || user.must_change_password,
        sid: parsed.data.sid,
        idleExpiresAt: expiresAt.getTime(),
      };
    });
  } catch {
    console.error("[auth] SESSION_UNAVAILABLE");
    return {};
  }
}
