import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { JWT } from "next-auth/jwt";
import type { User } from "next-auth";
import { getPrisma } from "@/server/db/prisma";
import { getIdleTimeoutMs, isSessionExpired } from "./idle-policy";
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

    const expiresAt = new Date(now.getTime() + getIdleTimeoutMs());
    await tx.sessions.create({
      data: {
        user_id: user.id,
        token_hash: hashSessionKey(sid),
        created_at: now,
        last_activity_at: now,
        expires_at: expiresAt,
      },
    });
    // La sesión y su único evento de acceso se confirman o revierten juntos.
    await tx.authentication_events.create({ data: { user_id: user.id, action: "LOGIN_OK", occurred_at: now } });
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
  if (typeof token?.sid !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token.sid) || typeof token.sub !== "string") return;
  return getPrisma().$transaction(async (tx) => {
    const now = new Date();
    const result = await tx.sessions.updateMany({
      where: { token_hash: hashSessionKey(token.sid!), user_id: token.sub, revoked_at: null },
      data: { revoked_at: now },
    });
    // updateMany revalida la condición tras esperar otra revocación concurrente.
    if (result.count === 1)
      await tx.authentication_events.create({ data: { user_id: token.sub!, action: "LOGOUT", occurred_at: now } });
  });
}

/** Solo el callback JWT decide si hubo una intención de actividad validada por CSRF. */
export async function validateIdentitySession(identity: { sid: string; sub: string; userVersion: number }, recordActivity: boolean) {
  const tokenHash = hashSessionKey(identity.sid);
  return getPrisma().$transaction(async (tx) => {
    // Serializar lectura, vencimiento, renovación y cierre de esta sesión.
    await tx.$queryRaw`SELECT id FROM sports_management.sessions WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const session = await tx.sessions.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true, user_id: true, last_activity_at: true, expires_at: true, revoked_at: true,
        users: { select: { id: true, is_active: true, locked_until: true, must_change_password: true, version: true } },
      },
    });
    if (!session || session.user_id !== identity.sub) return null;
    const now = new Date(); // Siempre después de obtener el bloqueo.
    const idleMs = getIdleTimeoutMs();
    const user = session.users;
    if (isSessionExpired(session, now, idleMs) || !user.is_active || user.version !== identity.userVersion ||
        (user.locked_until && user.locked_until > now)) {
      // Una configuración más permisiva posterior no resucita una sesión rechazada.
      if (!session.revoked_at) await tx.sessions.update({ where: { id: session.id }, data: { revoked_at: now } });
      return null;
    }
    let expiresAt = new Date(Math.min(session.expires_at.getTime(), session.last_activity_at.getTime() + idleMs));
    if (recordActivity) {
      expiresAt = new Date(now.getTime() + idleMs);
      await tx.sessions.update({ where: { id: session.id }, data: { last_activity_at: now, expires_at: expiresAt } });
    }
    return { userId: user.id, userVersion: user.version, mustChangePassword: user.must_change_password,
      idleExpiresAt: expiresAt.getTime() };
  });
}
