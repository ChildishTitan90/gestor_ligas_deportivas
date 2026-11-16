import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, lockAuthorization, type PermissionAction } from "@/server/auth/authorization";
import { assertOwnRefereeAssignment } from "@/server/auth/authorization-domain";
import { lockSeasonIdentityHistory } from "@/features/players/server/season-identity-history";
import { ReportError } from "../contract";

export async function reportAccess(tx: Prisma.TransactionClient, actorId: string, matchId: string, action: PermissionAction = "CREATE") {
  if (!z.uuid().safeParse(matchId).success) throw new AuthorizationError();
  await lockAuthorization(tx);
  await lockSeasonIdentityHistory(tx);
  await tx.$queryRaw`SELECT id FROM sports_management.matches WHERE id=${matchId}::uuid FOR UPDATE`;
  const match = await tx.matches.findFirst({ where: { id: matchId, deleted_at: null }, select: {
    id: true, number: true, version: true, starts_at: true, ends_at: true, season_id: true, home_team_id: true, away_team_id: true,
    status_id: true, match_statuses: { select: { code: true, name: true } },
  } });
  if (!match) throw new AuthorizationError();
  const season = await tx.seasons.findUniqueOrThrow({ where: { id: match.season_id }, select: { league_id: true, status: true } });
  const context = { leagueId: season.league_id, seasonId: match.season_id, matchId };
  const grants = await assertPermission(tx, actorId, { module: "match-reports", action, context });
  if (action !== "READ") {
    const roles = await tx.roles.findMany({ where: { id: { in: grants.map(g => g.roleId) } }, select: { code: true } });
    if (!roles.some(r => r.code === "DATA_ENTRY")) {
      if (!roles.some(r => r.code === "REFEREE")) throw new AuthorizationError();
      await assertOwnRefereeAssignment(tx, actorId, matchId);
    }
  }
  return { ...match, season };
}
export async function reportReadAccess(tx: Prisma.TransactionClient, actorId: string, matchId: string) {
  try { return await reportAccess(tx, actorId, matchId, "CREATE"); }
  catch (error) { if (!(error instanceof AuthorizationError)) throw error; return reportAccess(tx, actorId, matchId, "READ"); }
}
export function assertCaptureState(match: Awaited<ReturnType<typeof reportAccess>>) {
  if (match.season.status === "CLOSED") throw new ReportError("CLOSED_SEASON");
  // PDGLD-18 prepara alineaciones en CONFIRMED; no inicia ni finaliza partidos.
  if (!["CONFIRMED", "IN_PROGRESS"].includes(match.match_statuses.code)) throw new ReportError("MATCH_STATE_BLOCKED");
}
