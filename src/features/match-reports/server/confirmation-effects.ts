import "server-only";
import { calculateConfirmedReportStandingsInTransaction } from "@/features/standings/server/service";
import type { Prisma } from "@prisma/client";
import { ReportError, type ReportReceipt } from "../contract";
import { reportErrorMessage } from "../feedback";
import type { ReportDemoData } from "../types";

export const confirmationBlockers = ["PDGLD-85: transición autorizada con historial", "Receptor mínimo de expedientes disciplinarios"];
export type ConfirmationContext = { actorId: string; matchId: string; reportId: string; operationId: string; expectedMatchVersion: number; homeScore: number; awayScore: number; eventIds: string[]; dismissals: { eventId: string; playerId: string; teamId: string; reason: "SECOND_CAUTION" | "DIRECT_RED" }[] };
/** Deben compartir tx, lanzar ante fallo y deduplicar por reportId/operationId. Sin I/O externo. */
export interface ConfirmationEffects {
  finishMatch(tx: Prisma.TransactionClient, context: ConfirmationContext): Promise<number>;
  openIncidentCases(tx: Prisma.TransactionClient, context: ConfirmationContext): Promise<void>;
}
/** Disponibilidad de la integración; no sustituye autorización ni reglas de cierre. */
export function getConfirmationAvailability(): NonNullable<ReportDemoData["confirmation"]> {
  return { available: false, message: reportErrorMessage("CONFIRMATION_DEPENDENCIES_PENDING") };
}
export function getConfirmationEffects(): ConfirmationEffects {
  // Sin adaptadores integrados: ninguna bandera de cliente ni fila de matriz habilita el cierre.
  throw new ReportError("CONFIRMATION_DEPENDENCIES_PENDING", 409);
}
export async function applyConfirmationEffects(tx: Prisma.TransactionClient, context: ConfirmationContext, effects: ConfirmationEffects): Promise<ReportReceipt> {
  await tx.match_results.create({ data: { match_id: context.matchId, home_score: context.homeScore, away_score: context.awayScore, source: "MATCH_REPORT", validated_by: context.actorId } });
  const matchVersion = await effects.finishMatch(tx, context);
  const report = await tx.match_reports.update({ where: { id: context.reportId }, data: { status: "CONFIRMED", confirmed_at: new Date() }, select: { version: true } });
  // The engine must observe CONFIRMED, persisted events and the official result.
  await calculateConfirmedReportStandingsInTransaction(tx, context.actorId, context.reportId);
  await effects.openIncidentCases(tx, context);
  return { formatVersion: 1, operationId: context.operationId, matchId: context.matchId, reportId: context.reportId, reportVersion: report.version, matchVersion, status: "CONFIRMED" };
}
