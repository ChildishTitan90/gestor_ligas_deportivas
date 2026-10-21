import "server-only";

function positiveInteger(name: string, value: string, maximum: number) {
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) ||
      Number(value) < 1 || Number(value) > maximum) {
    // No incluir el valor recibido: puede ser una configuración sensible errónea.
    throw new Error(`${name} debe ser un entero entre 1 y ${maximum}.`);
  }
  return Number(value);
}

/** Leer por petición; una configuración inválida nunca adopta el valor por defecto. */
export function getLoginPolicy(env: {
  AUTH_MAX_FAILED_ATTEMPTS?: string; AUTH_LOCKOUT_MINUTES?: string;
} = {
  AUTH_MAX_FAILED_ATTEMPTS: process.env.AUTH_MAX_FAILED_ATTEMPTS,
  AUTH_LOCKOUT_MINUTES: process.env.AUTH_LOCKOUT_MINUTES,
}) {
  return {
    maxFailedAttempts: positiveInteger("AUTH_MAX_FAILED_ATTEMPTS", env.AUTH_MAX_FAILED_ATTEMPTS ?? "5", 20),
    lockoutMs: positiveInteger("AUTH_LOCKOUT_MINUTES", env.AUTH_LOCKOUT_MINUTES ?? "15", 1440) * 60_000,
  };
}
