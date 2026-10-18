import "server-only";

/** El servidor decide el plazo; el navegador nunca envía tiempos de vigencia. */
export function getIdleTimeoutMs(value = process.env.AUTH_IDLE_TIMEOUT_MINUTES ?? "30") {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error("AUTH_IDLE_TIMEOUT_MINUTES debe ser un entero entre 1 y 1440.");
  }
  return minutes * 60_000;
}

export function getIdleTimeoutSeconds() {
  return getIdleTimeoutMs() / 1000;
}

type SessionDates = { last_activity_at: Date; expires_at: Date; revoked_at: Date | null };

/** El vencimiento persistido y el límite configurado se comprueban conjuntamente. */
export function isSessionExpired(session: SessionDates, now = new Date(), idleMs = getIdleTimeoutMs()) {
  const current = now.getTime();
  const lastActivity = session.last_activity_at.getTime();
  const expiration = session.expires_at.getTime();
  return session.revoked_at !== null || !Number.isFinite(current) || !Number.isFinite(lastActivity) ||
    !Number.isFinite(expiration) || !Number.isSafeInteger(idleMs) || idleMs <= 0 ||
    lastActivity > current || current >= expiration || current - lastActivity >= idleMs;
}
