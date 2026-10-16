import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getPrisma } from "@/server/db/prisma";
import {
  getIdleTimeoutMs,
  isSessionExpired,
} from "./session-policy";

function hashSessionSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function isValidSessionSecret(secret: unknown): secret is string {
  return (
    typeof secret === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(secret)
  );
}

// Solo llamar después de verificar correctamente las credenciales.
export async function createPersistentSession(
  userId: string,
  userVersion: number,
): Promise<string | null> {
  const idleTimeoutMs = getIdleTimeoutMs();

  return getPrisma().$transaction(async (tx) => {
    const now = new Date();

    const user = await tx.users.findFirst({
      where: {
        id: userId,
        version: userVersion,
        is_active: true,
        OR: [
          { locked_until: null },
          { locked_until: { lte: now } },
        ],
      },
      select: { id: true },
    });

    if (!user) return null;

    // El secreto viajará únicamente dentro del JWT cifrado.
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + idleTimeoutMs);

    if (!Number.isFinite(expiresAt.getTime())) {
      throw new Error("La configuración de vencimiento no es válida.");
    }

    await tx.sessions.create({
      data: {
        user_id: user.id,
        token_hash: hashSessionSecret(secret),
        created_at: now,
        last_activity_at: now,
        expires_at: expiresAt,
      },
    });

    await tx.authentication_events.create({
      data: {
        user_id: user.id,
        action: "LOGIN_OK",
        occurred_at: now,
      },
    });

    return secret;
  });
}

// Revoca únicamente la sesión identificada por su secreto.
export async function revokePersistentSession(
  secret: unknown,
): Promise<boolean> {
  if (!isValidSessionSecret(secret)) return false;

  const tokenHash = hashSessionSecret(secret);

  return getPrisma().$transaction(async (tx) => {
    const session = await tx.sessions.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true,
        user_id: true,
      },
    });

    if (!session) return false;

    const now = new Date();

    // La condición evita duplicar LOGOUT en cierres simultáneos.
    const result = await tx.sessions.updateMany({
      where: {
        id: session.id,
        revoked_at: null,
      },
      data: {
        revoked_at: now,
      },
    });

    if (result.count === 0) return false;

    await tx.authentication_events.create({
      data: {
        user_id: session.user_id,
        action: "LOGOUT",
        occurred_at: now,
      },
    });

    return true;
  });
  
}

type SessionValidationOptions = {
  touch?: boolean;
  now?: Date;
};

export async function validatePersistentSession(
  secret: unknown,
  userId: string,
  userVersion: number,
  options: SessionValidationOptions = {},
) {
  if (!isValidSessionSecret(secret)) return null;

  const tokenHash = hashSessionSecret(secret);
  const idleTimeoutMs = getIdleTimeoutMs();

  return getPrisma().$transaction(async (tx) => {
    // Serializar validación, renovación y cierre de esta sesión.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM sports_management.sessions
      WHERE token_hash = ${tokenHash}
      FOR UPDATE
    `;

    if (rows.length === 0) return null;

    const session = await tx.sessions.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true,
        user_id: true,
        last_activity_at: true,
        expires_at: true,
        revoked_at: true,
        users: {
          select: {
            id: true,
            version: true,
            is_active: true,
            locked_until: true,
            must_change_password: true,
          },
        },
      },
    });

    if (!session || session.user_id !== userId) return null;

    // Obtener la hora después de adquirir el bloqueo.
    // Las pruebas pueden proporcionar una fecha controlada.
    const now = options.now ?? new Date();

    if (!Number.isFinite(now.getTime())) return null;

    const user = session.users;

    const accountInvalid =
      !user.is_active ||
      user.version !== userVersion ||
      (user.locked_until !== null && user.locked_until > now);

    if (
      accountInvalid ||
      isSessionExpired(session, now, idleTimeoutMs)
    ) {
      // Persistir la invalidación para impedir que vuelva a usarse.
      if (session.revoked_at === null) {
        await tx.sessions.update({
          where: { id: session.id },
          data: { revoked_at: now },
        });
      }

      return null;
    }

    let expiresAt = session.expires_at;

    // Consultar la sesión no renueva automáticamente su actividad.
    if (options.touch === true) {
      expiresAt = new Date(now.getTime() + idleTimeoutMs);

      if (!Number.isFinite(expiresAt.getTime())) {
        throw new Error(
          "La configuración de vencimiento no es válida.",
        );
      }

      await tx.sessions.update({
        where: { id: session.id },
        data: {
          last_activity_at: now,
          expires_at: expiresAt,
        },
      });
    }

    return {
      userId: user.id,
      userVersion: user.version,
      mustChangePassword: user.must_change_password,
      expiresAt,
    };
  });
}