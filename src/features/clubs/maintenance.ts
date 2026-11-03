import { z } from "zod";

export const maintenanceSchema = z.strictObject({
  kind: z.enum(["club", "team"]), id: z.uuid(), version: z.number().int().positive(),
  operation: z.enum(["edit", "deactivate", "reactivate"]),
  name: z.string().trim().min(2).max(160).optional(),
  reason: z.string().trim().min(5).max(500), confirmed: z.literal(true),
}).superRefine((data, ctx) => {
  if (data.operation === "edit" && !data.name)
    ctx.addIssue({ code: "custom", path: ["name"], message: "Escribe el nombre." });
  if (data.operation !== "edit" && data.name !== undefined)
    ctx.addIssue({ code: "custom", path: ["name"], message: "La baja no modifica datos generales." });
});

export type MaintenanceRow = {
  kind: "club" | "team"; id: string; clubId: string; name: string; reference: string;
  clubName: string; leagueName: string; status: string; clubStatus: string; version: number;
  canEdit: boolean; canChangeStatus: boolean; hasHistory: boolean;
};
export function effectiveStatus(status: string, clubStatus: string) {
  return clubStatus !== "ACTIVE" ? "Bloqueado por baja del club" : administrativeStatus(status);
}
export function administrativeStatus(status: string) {
  return ({ ACTIVE: "Activo", INACTIVE: "Baja temporal", SUSPENDED: "Suspendido", WITHDRAWN: "Retirado" } as Record<string, string>)[status] ?? "Estado no disponible";
}
export const maintenanceErrors: Record<string, string> = {
  INVALID_INPUT: "Revisa el nombre, el motivo y la confirmación.",
  FORBIDDEN: "No tienes permiso para esta operación en este ámbito.",
  CONFLICT: "El registro cambió. Actualiza la lista y revisa los datos antes de intentar de nuevo.",
  FORMAL_CHANGE_REQUIRED: "El nombre tiene historial. Su cambio requiere el trámite formal de cambios de club o equipo (PDGLD-92).",
  DUPLICATE: "Ya existe ese nombre en el mismo ámbito.",
  INVALID_STATE: "El estado actual no permite esta operación.",
  UNAUTHENTICATED: "Tu sesión terminó. Inicia sesión de nuevo.",
  PASSWORD_CHANGE_REQUIRED: "Debes cambiar tu contraseña para continuar.",
  UNAVAILABLE: "No se pudo confirmar el resultado. Consulta el registro antes de volver a enviarlo.",
};
