import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { JWT } from "next-auth/jwt";
import type { User } from "next-auth";
import { getPrisma } from "@/server/db/prisma";
import { getIdleTimeoutSeconds } from "./idle-policy";
import { lockAuthUser } from "./lock-user";

export function hashSessionKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export async function createIdentityToken(identity: User): Promise<JWT> {
  const sid = randomBytes(32).toString("base64url");
  return getPrisma().$transaction(async (tx) => {
    const user = await lockAuthUser(tx, identity.id);
    const now = new Date();
    if (!user || !user.is_active || user.version !== identity.userVersion ||
      (user.locked_until && user.locked_until > now)) return {};

    const expiresAt = new Date(now.getTime() + getIdleTimeoutSeconds() * 1000);
    await tx.sessions.create({
      data: {
        user_id: user.id,
        token_hash: hashSessionKey(sid),
        created_at: now,
        last_activity_at: now,
        expires_at: expiresAt,
      },
    });
    return {
      sub: user.id,
      userVersion: user.version,
      mustChangePassword: identity.mustChangePassword || user.must_change_password,
      sid,
      idleExpiresAt: expiresAt.getTime(),
    };
  });
}

/** Cerrar una sesión no invalida las de otros navegadores del mismo usuario. */
export async function revokeIdentityToken(token: JWT | null) {
  if (typeof token?.sid !== "string" || typeof token.sub !== "string") return;
  await getPrisma().sessions.updateMany({
    where: { token_hash: hashSessionKey(token.sid), user_id: token.sub, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}
