import { z } from "zod";
const base = { operationKey: z.uuid(), leagueId: z.uuid(), seasonId: z.uuid(), reason: z.string().trim().min(5).max(500) };
export const refereeMutation = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("register"), personId: z.uuid(), clubId: z.uuid(), active: z.boolean(), expectedVersion: z.number().int().nonnegative() }),
  z.strictObject({ ...base, kind: z.literal("availability"), refereeId: z.uuid(), expectedVersion: z.number().int().positive(), intervalId: z.uuid().optional(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), available: z.boolean() }),
  z.strictObject({ ...base, kind: z.literal("propose"), refereeId: z.uuid(), matchId: z.uuid(), expectedMatchVersion: z.number().int().positive() }),
  z.strictObject({ ...base, kind: z.enum(["approve", "revoke"]), assignmentId: z.uuid(), expectedVersion: z.number().int().positive(), expectedMatchVersion: z.number().int().positive() }),
]);
export type RefereeMutation = z.infer<typeof refereeMutation>;
export const blockerMessages: Record<string, string> = {
  INVALID_CONTEXT: "La liga, temporada, categoría o grupo no corresponden al encuentro.", CLOSED_CONTEXT: "El contexto está cerrado; conserva el antecedente.",
  MATCH_NOT_SCHEDULED: "El partido requiere programación y horario vigentes.", INACTIVE: "Árbitro inactivo.", INACTIVE_LEAGUE: "Liga inactiva.",
  INVALID_PRESENTATION: "Falta una presentación válida por un club activo y afiliado en la temporada.",
  CLUB_IN_GROUP: "Un equipo del club que presenta al árbitro pertenece al grupo del encuentro, aunque no dispute este partido.",
  INVALID_TEAMS: "Los equipos deben estar inscritos y activos en la misma temporada, categoría y grupo.",
  INVALID_TIME: "Falta un horario completo y válido.", UNAVAILABLE: "Existe una indisponibilidad en el horario del partido.",
  UNKNOWN_AVAILABILITY: "No hay disponibilidad que cubra todo el encuentro.", OVERLAP: "Se traslapa con otra designación aprobada.",
  DUPLICATE: "Ya existe una propuesta o designación no revocada para ese árbitro y partido.", SLOT_TAKEN: "El partido ya tiene árbitro principal aprobado.",
  IDENTITY_CHANGED: "Cambió la identidad desde la aprobación. Revoca y vuelve a proponer para revisarla.",
  STALE_VERSION: "Los datos cambiaron. Cierra y vuelve a abrir el diálogo para revisar el estado vigente antes de otra operación.", FORBIDDEN: "No tienes permiso o alcance para esta operación.",
  HISTORICAL_REFEREE_UNPROTECTED: "Falta evidencia histórica protegida para este antecedente.",
  CONCURRENT_OR_DEPENDENCY_CONFLICT: "El cambio entra en conflicto con una aprobación vigente u otra operación. Consulta los datos y revoca o resuelve la designación afectada antes de cambiar sus dependencias.",
  OPERATION_KEY_REUSED: "La clave ya corresponde a otro contenido. Consulta el acuse de la solicitud original.",
  PRESENTING_CLUB_FIXED: "El club de origen queda fijo durante la temporada. No se puede trasladar esta presentación a otro club.",
  INVALID_TRANSITION: "La designación ya no admite esa operación. Consulta su estado actual.",
};
