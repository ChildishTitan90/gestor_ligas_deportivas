import "server-only";

import type { JWT } from "next-auth/jwt";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";

const identityTokenSchema = z.object({
  sub: z.uuid(),
  userVersion: z.number().int().positive(),
  mustChangePassword: z.boolean(),
});

/** Revalidar estado actual; los campos de update() del navegador no son autoridad. */
export async function refreshIdentityToken(token: JWT): Promise<JWT> {
  const parsed = identityTokenSchema.safeParse(token);
  if (!parsed.success) return {};
  try {
    const user = await getPrisma().users.findUnique({
      where: { id: parsed.data.sub },
      select: { id: true, is_active: true, locked_until: true, must_change_password: true, version: true },
    });
    if (!user || !user.is_active || user.version !== parsed.data.userVersion ||
      (user.locked_until && user.locked_until > new Date())) return {};

    return {
      sub: user.id,
      userVersion: user.version,
      // Una sesión restringida requiere nuevo login después del cambio.
      mustChangePassword: parsed.data.mustChangePassword || user.must_change_password,
    };
  } catch {
    console.error("[auth] SESSION_UNAVAILABLE");
    return {};
  }
}
