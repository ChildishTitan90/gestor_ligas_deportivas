import "server-only";

/** El servidor decide el plazo; el navegador nunca envía tiempos de vigencia. */
export function getIdleTimeoutSeconds() {
  const value = process.env.AUTH_IDLE_TIMEOUT_MINUTES ?? "30";
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error("AUTH_IDLE_TIMEOUT_MINUTES debe ser un entero entre 1 y 1440.");
  }
  return minutes * 60;
}
