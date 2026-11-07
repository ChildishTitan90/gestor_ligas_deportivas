import { z } from "zod";
import type { EmailChangeResult, EmailDelivery } from "./email-change-contract";

export const maintenanceAccountSchema = z.object({ id: z.uuid(), username: z.string(), isActive: z.boolean(), revision: z.number().int().nonnegative() });
export const maintenanceIdentifiersSchema = z.object({ id: z.uuid(), username: z.string(), email: z.email(), revision: z.number().int().nonnegative() });
export type MaintenanceAccount = z.infer<typeof maintenanceAccountSchema>;
export type MaintenanceIdentifiers = z.infer<typeof maintenanceIdentifiersSchema>;
export type MaintenancePage = { items: MaintenanceAccount[]; page: number; pageSize: number; total: number };
export type MaintenanceDetail = { account: MaintenanceAccount; identifiers?: MaintenanceIdentifiers };
export type MaintenanceOperation = "username" | "email" | "status";

export class MaintenanceClientError extends Error {
  constructor(readonly code: string, readonly status = 0) { super(code); }
}
const messages: Record<string, string> = {
  UNAUTHENTICATED: "La sesión terminó o fue revocada. Inicia sesión para continuar.",
  PASSWORD_CHANGE_REQUIRED: "Debes cambiar tu contraseña antes de continuar.",
  FORBIDDEN: "Ya no tienes permiso para esta operación. Se ocultaron los datos privados.",
  ACCOUNT_CHANGED: "La cuenta cambió desde que la abriste. Consulta la versión actual y vuelve a revisar antes de confirmar.",
  ACCOUNT_NOT_FOUND: "La cuenta ya no está disponible.",
  DUPLICATE_ACCOUNT: "Alguno de los identificadores ya está ocupado. Revisa la captura.",
  ACCOUNT_IDENTIFIERS_UNCHANGED: "El identificador coincide con el actual.",
  ACCOUNT_STATE_UNCHANGED: "La cuenta ya tiene ese estado. Consulta la versión actual.",
  ACCOUNT_NOT_OPERATIONAL: "La cuenta debe estar activa y sin bloqueo para solicitar el cambio de correo.",
  EMAIL_CHANGE_RATE_LIMITED: "Se alcanzó el límite de solicitudes. Espera antes de iniciar otra.",
  EMAIL_CHANGE_NOT_FOUND: "La solicitud todavía no aparece. Esto no confirma que el envío haya fallado. Consulta nuevamente o reintenta únicamente la misma solicitud.",
  EMAIL_OPERATION_CONFLICT: "La clave de esta solicitud corresponde a otra captura. Revisa el estado antes de continuar.",
  LAST_ACTIVE_SUPERADMIN: "Debe permanecer otro SUPERADMIN activo con asignación vigente.",
  LAST_EFFECTIVE_SUPERADMIN: "Debe permanecer otro administrador con permisos globales de lectura y actualización.",
  LAST_OPERATIONAL_SUPERADMIN: "Debe quedar otro administrador que pueda operar, sin bloqueo temporal ni cambio obligatorio de contraseña.",
  VALIDATION_ERROR: "Revisa el identificador, un motivo de 10 a 300 caracteres y la confirmación.",
  OFFLINE: "No hay conexión. No se envió la operación; conserva esta página y vuelve a intentar cuando se restablezca.",
};
export function maintenanceMessage(code: string) {
  return Object.hasOwn(messages, code) ? messages[code] : "No se pudo comprobar el resultado. Consulta el estado antes de intentar otra operación.";
}
export function deliveryMessage(delivery: EmailDelivery) {
  return ({ NOT_CONFIGURED: "NOT_CONFIGURED: no hay transporte de correo configurado; no se envió este mensaje.",
    ACCEPTED: "El transporte aceptó el mensaje; esto no acredita entrega ni confirmación de propiedad.",
    PENDING: "El envío está pendiente; no se acredita entrega.", FAILED: "El transporte informó un fallo de envío.",
    UNKNOWN: "No se conoce el resultado del envío. No se reenviará automáticamente." })[delivery];
}
export function emailChangeMessage(result: EmailChangeResult) {
  return result.status === "CONFIRMED" ? "El servidor registra el correo confirmado y la revocación de sesiones anteriores." : result.status === "SUPERSEDED"
    ? "Esta solicitud fue reemplazada y ya no puede confirmarse."
    : "Solicitud pendiente de confirmar propiedad. El correo anterior conserva el acceso; el nuevo no se usa para recuperación ni entrega de contraseñas antes de verificarlo.";
}
