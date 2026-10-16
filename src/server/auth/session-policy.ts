import "server-only";

const MINUTE_MS = 60_000;
const DEFAULT_IDLE_MINUTES = 30;

export function getIdleTimeoutMs(
  configuredValue = process.env.AUTH_IDLE_TIMEOUT_MINUTES,
): number {
  const minutes =
    configuredValue === undefined
      ? DEFAULT_IDLE_MINUTES
      : Number(configuredValue);

  const milliseconds = minutes * MINUTE_MS;

  if (
    !Number.isSafeInteger(minutes) ||
    minutes <= 0 ||
    !Number.isSafeInteger(milliseconds)
  ) {
    throw new Error(
      "AUTH_IDLE_TIMEOUT_MINUTES debe ser un entero positivo.",
    );
  }

  return milliseconds;
}

type SessionDates = {
  last_activity_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

export function isSessionExpired(
  session: SessionDates,
  now: Date = new Date(),   
  idleTimeoutMs: number = getIdleTimeoutMs(),
): boolean {
  if (session.revoked_at !== null) return true;

  const currentTime = now.getTime();
  const lastActivity = session.last_activity_at.getTime();
  const expiration = session.expires_at.getTime();

  // Rechazar fechas o configuraciones inválidas.
  if (
    !Number.isFinite(currentTime) ||
    !Number.isFinite(lastActivity) ||
    !Number.isFinite(expiration) ||
    !Number.isSafeInteger(idleTimeoutMs) ||
    idleTimeoutMs <= 0
  ) {
    return true;
  }

  // Una actividad futura no debe ampliar la sesión.
  if (lastActivity > currentTime) return true;

  return (
    currentTime >= expiration ||
    currentTime - lastActivity >= idleTimeoutMs
  );
}