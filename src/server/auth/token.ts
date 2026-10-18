import "server-only";

import type { JWT } from "next-auth/jwt";
import { z } from "zod";
import { validateIdentitySession } from "./persistent-session";

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
    const session = await validateIdentitySession(parsed.data, recordActivity);
    if (!session) return {};
    return {
      sub: session.userId,
      userVersion: session.userVersion,
      mustChangePassword: parsed.data.mustChangePassword || session.mustChangePassword,
      sid: parsed.data.sid,
      idleExpiresAt: session.idleExpiresAt,
    };
  } catch {
    console.error("[auth] SESSION_UNAVAILABLE");
    return {};
  }
}
