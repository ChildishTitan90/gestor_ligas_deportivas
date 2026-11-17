import "server-only";
import type { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { assertOwnRefereeAssignment } from "@/server/auth/authorization-domain";

/** Contrato de inicio para PDGLD-18/85. El llamador ya bloqueó autorización,
 * temporada y partido. Se compone con reloj, versión de cédula y acuse dentro
 * de la misma transacción. No implementa finalización ni otras transiciones. */
export async function startReportMatchInTransaction(tx: Prisma.TransactionClient, actorId: string, match: { id: string; version: number; status_id: string; season_id: string; season: { league_id: string; status: string }; match_statuses: { code: string; name: string } }, operationId: string) {
  const grants = await assertPermission(tx, actorId, { module: "match-reports", action: "UPDATE", context: { leagueId: match.season.league_id, seasonId: match.season_id, matchId: match.id } });
  const roles = await tx.roles.findMany({ where: { id: { in: grants.map(g => g.roleId) } }, select: { code: true } });
  if (!roles.some(r => r.code === "DATA_ENTRY")) {
    if (!roles.some(r => r.code === "REFEREE")) throw new AuthorizationError();
    await assertOwnRefereeAssignment(tx, actorId, match.id);
  }
  if (match.season.status === "CLOSED" || !["CONFIRMED", "IN_PROGRESS"].includes(match.match_statuses.code)) throw new AuthorizationError();
  if (match.match_statuses.code === "IN_PROGRESS") return null;
  const status = await tx.match_statuses.findUniqueOrThrow({ where: { code: "IN_PROGRESS" }, select: { id: true, code: true, name: true } });
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason','Inicio del partido desde cédula con reloj',true)`;
  const result = await tx.matches.updateMany({ where: { id: match.id, version: match.version, status_id: match.status_id, deleted_at: null }, data: { status_id: status.id, version: { increment: 1 } } });
  if (result.count !== 1) throw new AuthorizationError();
  await tx.match_status_history.create({ data: { id: operationId, match_id: match.id, previous_status_id: match.status_id, new_status_id: status.id, user_id: actorId, reason: "Inicio del partido desde la cédula; reloj de captura activado" } });
  return { status_id: status.id, version: match.version + 1, match_statuses: { code: status.code, name: status.name } };
}
