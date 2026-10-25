import { z } from "zod";

// Respuesta del backend existente de PDGLD-57.
// Un reintento puede recuperar una solicitud que ya fue revisada.
export const affiliationResultSchema = z.strictObject({
  id: z.uuid(),
  referenceNumber: z.string().trim().min(1),
  status: z.string().trim().min(1),
  replayed: z.boolean(),
});

export type AffiliationResult = z.infer<typeof affiliationResultSchema>;

const messages: Record<string, string> = {
  UNAUTHENTICATED:
    "Tu sesión terminó. Inicia sesión para continuar.",
  PASSWORD_CHANGE_REQUIRED:
    "Debes cambiar tu contraseña antes de enviar la solicitud.",
  FORBIDDEN:
    "No tienes autorización para enviar la solicitud de este club.",
  INVALID_ORIGIN:
    "No se pudo validar el origen del envío. Recarga la página.",
  INVALID_PAYLOAD:
    "No se pudo procesar la solicitud. Revisa los datos.",
  VALIDATION_ERROR:
    "Revisa los datos obligatorios antes de enviar.",
  INVALID_CONTEXT:
    "El club, la temporada o las categorías no están disponibles.",
  INVALID_SIGNATURE:
    "Una firma no es válida o no está disponible. Revisa las tres firmas.",
  SEASON_CLOSED:
    "La temporada está cerrada para nuevas solicitudes.",
  AFFILIATION_EXISTS:
    "Este club ya tiene una solicitud para esa temporada.",
  IDEMPOTENCY_CONFLICT:
    "Este envío ya se utilizó con otros datos. Revisa el resultado anterior.",
  PAYLOAD_TOO_LARGE:
    "La solicitud supera el tamaño permitido.",
  SERVICE_UNAVAILABLE:
    "No se pudo confirmar el envío. Conservamos los datos para reintentar.",
};

export function affiliationErrorMessage(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "code" in body &&
    typeof body.code === "string" &&
    Object.hasOwn(messages, body.code)
  ) {
    return messages[body.code];
  }

  return "No se pudo confirmar el envío. Conserva los datos e inténtalo de nuevo.";
}