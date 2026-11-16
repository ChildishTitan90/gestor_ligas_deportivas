import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, getPermissionGrants, lockAuthorization, type PermissionAction } from "@/server/auth/authorization";
import { assertOwnRefereeAssignment } from "@/server/auth/authorization-domain";
import { lockSeasonIdentityHistory } from "@/features/players/server/season-identity-history";
import { ReportError } from "../contract";

/** El límite pertenece al conjunto autorizado, nunca a los partidos globales.
 * Usa las concesiones vigentes de RF22 y la misma función de designación efectiva
 * que assertOwnRefereeAssignment. El consumidor revalida cada acceso al leerlo. */
export async function readCaptureMatchIds(tx: Prisma.TransactionClient, actorId: string) {
  const grants = await getPermissionGrants(tx, actorId, "match-reports", "CREATE");
  await lockSeasonIdentityHistory(tx);
  const roles = await tx.roles.findMany({ where: { id: { in: grants.map(grant => grant.roleId) } }, select: { id: true, code: true } });
  const scopes = grants.flatMap(grant => {
    const role = roles.find(role => role.id === grant.roleId)?.code;
    if (!["DATA_ENTRY", "REFEREE"].includes(role ?? "") || (grant.contextOnly && !grant.leagueId && !grant.clubId)) return [];
    const league = grant.leagueId ? Prisma.sql`s.league_id = ${grant.leagueId}::uuid` : Prisma.sql`TRUE`;
    const club = grant.clubId ? Prisma.sql`${grant.clubId}::uuid IN (hc.id, ac.id)` : Prisma.sql`TRUE`;
    const ownership = role === "DATA_ENTRY" ? Prisma.sql`TRUE` : Prisma.sql`EXISTS (
      SELECT 1 FROM sports_management.referee_assignments ra
      JOIN sports_management.referees r ON r.id = ra.referee_id
      JOIN sports_management.users u ON u.person_id = r.person_id
      WHERE ra.match_id = m.id AND u.id = ${actorId}::uuid
        AND ra.status = 'APPROVED' AND r.is_active
        AND sports_management.referee_assignment_effective(ra.id)
    )`;
    return [Prisma.sql`(${league} AND ${club} AND ${ownership})`];
  });
  if (!scopes.length) return [];
  return tx.$queryRaw<{ id: string }[]>`
    SELECT m.id FROM sports_management.matches m
    JOIN sports_management.seasons s ON s.id = m.season_id
    JOIN sports_management.leagues l ON l.id = s.league_id AND l.is_active
    JOIN sports_management.season_teams ht ON ht.id = m.home_team_id AND ht.season_id = m.season_id
    JOIN sports_management.season_teams at ON at.id = m.away_team_id AND at.season_id = m.season_id
    JOIN sports_management.clubs hc ON hc.id = ht.club_id AND hc.league_id = l.id AND hc.status = 'ACTIVE'
    JOIN sports_management.clubs ac ON ac.id = at.club_id AND ac.league_id = l.id AND ac.status = 'ACTIVE'
    WHERE m.deleted_at IS NULL AND (${Prisma.join(scopes, " OR ")})
    ORDER BY m.starts_at DESC NULLS FIRST, m.id DESC
    LIMIT 100`;
}

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
