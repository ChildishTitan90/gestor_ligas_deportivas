import "server-only";
import { calculateConfirmedReportStandingsInTransaction } from "@/features/standings/server/service";
import type { Prisma } from "@prisma/client";
import { ReportError, type ReportReceipt } from "../contract";
import type { ReportDemoData } from "../types";
import { finishConfirmedReportMatch } from "@/features/matches/server/report-finish";
import { openIncidentCases } from "./incident-cases";
import { advancePlayoffResultInTransaction } from "@/features/competitions/server/playoff-advance";

export const confirmationBlockers: string[] = [];
export type ConfirmationContext = { actorId: string; matchId: string; reportId: string; operationId: string; expectedMatchVersion: number; homeScore: number; awayScore: number; eventIds: string[]; dismissals: { eventId: string; playerId: string; teamId: string; reason: "SECOND_CAUTION" | "DIRECT_RED" }[] };
/** Deben compartir tx, lanzar ante fallo y deduplicar por reportId/operationId. Sin I/O externo. */
export interface ConfirmationEffects {
  finishMatch(tx: Prisma.TransactionClient, context: ConfirmationContext): Promise<number>;
  openIncidentCases(tx: Prisma.TransactionClient, context: ConfirmationContext): Promise<void>;
}
/** Disponibilidad de la integración; no sustituye autorización ni reglas de cierre. */
export function getConfirmationAvailability(): NonNullable<ReportDemoData["confirmation"]> {
  return { available: true, message: "La confirmación registra el resultado y actualiza la clasificación." };
}
export function getConfirmationEffects(): ConfirmationEffects {
  return { finishMatch: finishConfirmedReportMatch, openIncidentCases };
}
export async function applyConfirmationEffects(tx: Prisma.TransactionClient, context: ConfirmationContext, effects: ConfirmationEffects): Promise<ReportReceipt> {
  await tx.match_results.create({ data: { match_id: context.matchId, home_score: context.homeScore, away_score: context.awayScore, source: "MATCH_REPORT", validated_by: context.actorId }, select: { id: true } });
  const matchVersion = await effects.finishMatch(tx, context);
  const report = await tx.match_reports.update({ where: { id: context.reportId }, data: { status: "CONFIRMED", confirmed_at: new Date() }, select: { version: true } });
  // The engine must observe CONFIRMED, persisted events and the official result.
  try { await calculateConfirmedReportStandingsInTransaction(tx, context.actorId, context.reportId); }
  catch (error) {
    if (error instanceof Error && error.message === "RULES_NOT_APPROVED") throw new ReportError("STANDINGS_RULES_INCOMPLETE", 409);
    throw error;
  }
  await effects.openIncidentCases(tx, context);
  const match = await tx.matches.findUniqueOrThrow({ where: { id: context.matchId }, select: { stage_id: true } });
  if (match.stage_id) await advancePlayoffResultInTransaction(tx, context.matchId);
  return { formatVersion: 1, operationId: context.operationId, matchId: context.matchId, reportId: context.reportId, reportVersion: report.version, matchVersion, status: "CONFIRMED" };
}
