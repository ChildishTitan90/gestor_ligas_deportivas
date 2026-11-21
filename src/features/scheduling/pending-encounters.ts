import { z } from "zod";

export const pendingReasonMessages: Record<string, string> = {
  NO_OPENING: "No se encontró disponibilidad suficiente para la jornada.",
  LOAN_WINDOW: "No se encontró autorización de uso que cubra el horario.",
  VENUE_BLOCK: "Hay horarios afectados por bloqueos de cancha.",
  VENUE_STAGE: "La configuración de la jornada limita las canchas que pueden usarse.",
  FINAL_ROUNDS: "El reglamento limita las canchas para esta jornada.",
  DURATION: "La duración configurada no coincide con las canchas consideradas.",
  SEASON_BREAK: "Los horarios considerados coinciden con un descanso de la temporada.",
  OCCUPIED: "Los horarios viables pueden coincidir con otros encuentros o reservas; revisa las opciones de programación.",
  SEARCH_LIMIT: "La búsqueda alcanzó su límite; podría existir una combinación con menos pendientes.",
  TEAM_CHANGED: "Cambiaron los equipos; vuelve a asignar y validar la cancha y el horario.",
};

/** Un encuentro pendiente conserva su jornada y equipos sin inventar horario. */
export const pendingEncounterSchema = z.strictObject({
  matchdayId: z.uuid(), round: z.number().int().positive(), home: z.uuid(), away: z.uuid(),
  venueId: z.null(), start: z.null(), end: z.null(), reservedUntil: z.null(),
  factors: z.array(z.string()).max(20).optional(),
}).refine(match => match.home !== match.away);

export type PendingEncounter = z.infer<typeof pendingEncounterSchema>;

export function pendingEncounter(match: Pick<PendingEncounter, "matchdayId" | "round" | "home" | "away">): PendingEncounter {
  return pendingEncounterSchema.parse({ ...match, venueId: null, start: null, end: null, reservedUntil: null });
}
