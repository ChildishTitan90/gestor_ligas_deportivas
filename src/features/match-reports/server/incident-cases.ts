import "server-only";
import type { Prisma } from "@prisma/client";
import { ReportError } from "../contract";
import type { ConfirmationContext } from "./confirmation-effects";

/** Se ejecuta únicamente dentro de la transacción de confirmación oficial. */
export async function openIncidentCases(tx: Prisma.TransactionClient, context: ConfirmationContext): Promise<void> {
  const report = await tx.match_reports.findUnique({
    where: { id: context.reportId },
    select: { match_id: true, matches: { select: { season_id: true } },
      match_events: { select: { id: true, description: true, event_types: { select: { code: true } } } } },
  });
  if (!report || report.match_id !== context.matchId) throw new ReportError("INVALID_EVENT");
  const expected = new Set(context.eventIds);
  const dismissals = new Map(context.dismissals.map(item => [item.eventId, item.reason]));
  if (expected.size !== context.eventIds.length || report.match_events.length !== expected.size ||
      report.match_events.some(event => !expected.has(event.id)) ||
      [...dismissals.keys()].some(id => !expected.has(id))) throw new ReportError("INVALID_EVENT");

  const cases = report.match_events.flatMap(event => {
    const code = event.event_types.code;
    const dismissal = dismissals.get(event.id);
    if (dismissal && !((dismissal === "DIRECT_RED" && code === "SENDING_OFF") ||
      (dismissal === "SECOND_CAUTION" && code === "CAUTION"))) throw new ReportError("INVALID_EVENT");
    const label = code === "SENDING_OFF" ? "Expulsión directa" :
      dismissal === "SECOND_CAUTION" ? "Expulsión por segunda amarilla" :
      code === "SERIOUS_INCIDENT" ? "Incidente grave" : null;
    if (!label) return [];
    if (code === "SERIOUS_INCIDENT" && !event.description?.trim()) throw new ReportError("INCIDENT_DESCRIPTION_REQUIRED", 400);
    return [{ season_id: report.matches.season_id, reference_number: `CEDULA-${event.id}`,
      event_id: event.id, opened_by: context.actorId,
      description: event.description?.trim() ? `${label}: ${event.description.trim()}` : label }];
  });
  // La referencia determinista y su restricción única hacen seguro el reintento.
  if (cases.length) await tx.disciplinary_cases.createMany({ data: cases, skipDuplicates: true });
}
