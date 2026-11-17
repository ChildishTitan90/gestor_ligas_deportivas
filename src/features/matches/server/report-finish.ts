import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { assertOwnRefereeAssignment } from "@/server/auth/authorization-domain";
import { reportAccess } from "@/features/match-reports/server/access";
import type { ConfirmationEffects } from "@/features/match-reports/server/confirmation-effects";
import { MatchTransitionError } from "../transition-rules";

type AuthorizedReportMatch = {
  id: string;
  version: number;
  status_id: string;
  season_id: string;
  season: { league_id: string; status: string };
  match_statuses: { code: string };
};

/** Se llama después de reportAccess, con el bloqueo del partido y la autorización
 * vigentes, dentro de la transacción que crea resultado, clasificación y cédula.
 * No expone una entrada para finalizar partidos directamente desde el navegador. */
export async function finishReportMatchInTransaction(
  tx: Prisma.TransactionClient,
  actorId: string,
  match: AuthorizedReportMatch,
  input: { reportId: string; operationId: string; expectedMatchVersion: number; homeScore: number; awayScore: number },
): Promise<number> {
  if (!z.uuid().safeParse(input.reportId).success || !z.uuid().safeParse(input.operationId).success)
    throw new MatchTransitionError("INVALID_TRANSITION", 400);
  if (match.season.status === "CLOSED") throw new MatchTransitionError("SEASON_CLOSED");
  if (match.match_statuses.code !== "IN_PROGRESS") throw new MatchTransitionError("TRANSITION_NOT_IMPLEMENTED");
  if (match.version !== input.expectedMatchVersion) throw new MatchTransitionError("STALE_MATCH");

  const grants = await assertPermission(tx, actorId, {
    module: "match-reports", action: "UPDATE",
    context: { leagueId: match.season.league_id, seasonId: match.season_id, matchId: match.id },
  });
  const roles = await tx.roles.findMany({
    where: { id: { in: grants.map(grant => grant.roleId) }, code: { in: ["DATA_ENTRY", "REFEREE"] } },
    select: { id: true, code: true },
  });
  if (!roles.length) throw new AuthorizationError();
  if (!roles.some(role => role.code === "DATA_ENTRY")) await assertOwnRefereeAssignment(tx, actorId, match.id);

  const finished = await tx.match_statuses.findUniqueOrThrow({ where: { code: "FINISHED" }, select: { id: true } });
  const transition = await tx.match_status_transitions.findFirst({
    where: { from_status_id: match.status_id, to_status_id: finished.id, role_id: { in: roles.map(role => role.id) } },
    select: { id: true },
  });
  if (!transition) throw new AuthorizationError();

  const [report, result] = await Promise.all([
    tx.match_reports.findUnique({ where: { id: input.reportId }, select: { match_id: true, status: true } }),
    tx.match_results.findUnique({ where: { match_id: match.id }, select: {
      source: true, home_score: true, away_score: true, validated_by: true,
    } }),
  ]);
  if (!report || report.match_id !== match.id || report.status !== "DRAFT" ||
      result?.source !== "MATCH_REPORT" || result.home_score !== input.homeScore ||
      result.away_score !== input.awayScore || result.validated_by !== actorId)
    throw new MatchTransitionError("REPORT_RESULT_REQUIRED");

  const reason = "Confirmación de cédula arbitral";
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),
    set_config('app.reason',${reason},true), set_config('app.correlation_id',${input.operationId},true)`;
  const updated = await tx.matches.updateMany({
    where: { id: match.id, version: input.expectedMatchVersion, status_id: match.status_id, deleted_at: null },
    data: { status_id: finished.id, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new MatchTransitionError("STALE_MATCH");
  await tx.match_status_history.create({ data: {
    id: input.operationId, match_id: match.id, previous_status_id: match.status_id,
    new_status_id: finished.id, user_id: actorId, reason, expected_version: input.expectedMatchVersion,
  } });
  return input.expectedMatchVersion + 1;
}

/** Firma compatible con ConfirmationEffects.finishMatch. La cédula aporta la
 * autorización y el bloqueo antes del cierre; el adaptador los revalida para
 * que una integración posterior no pueda llamar la transición con datos forjados. */
export const finishConfirmedReportMatch: ConfirmationEffects["finishMatch"] = async (tx, context) => {
  const match = await reportAccess(tx, context.actorId, context.matchId, "UPDATE");
  return finishReportMatchInTransaction(tx, context.actorId, match, context);
};
