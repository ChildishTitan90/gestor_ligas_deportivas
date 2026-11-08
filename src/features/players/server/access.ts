import "server-only";
import type {AdmissionRule} from "../age-exception";
import type { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, getPermissionGrants, lockAuthorization } from "@/server/auth/authorization";
import { assertOwnPlayerRegistration } from "@/server/auth/authorization-domain";

export class PlayerRegistrationError extends Error {
  constructor(public readonly code: "VALIDATION_ERROR" | "CONTEXT_NOT_AVAILABLE" |
    "IDENTITY_UNAVAILABLE" | "REGISTRATION_CONFLICT" | "REGISTRATION_WINDOW_CLOSED" |
    "TEAM_CHANGE_NOT_ALLOWED" | "REVIEW_CAPACITY_EXCEEDED" | "RETRY_REQUIRED" |
    "PLAYER_POLICY_PENDING" | "AGE_OUTSIDE_RANGE" | "AGE_EXCEPTION_REQUIRED" | "AGE_EXCEPTION_NOT_APPLICABLE" | "AGE_EXCEPTION_DOCUMENT_REQUIRED" |
    "AGE_EXCEPTION_STALE" | "AGE_EXCEPTION_CONFLICT", public readonly status = 409, public readonly rule?: AdmissionRule) {
    super(code);
  }
}

export async function lockPlayerTeamContext(tx: Prisma.TransactionClient, actorId: string, seasonTeamId: string,
  action: "CREATE" | "READ" | "UPDATE" | "APPROVE") {
  await lockAuthorization(tx);
  const row = await readLockedPlayerTeamContext(tx, seasonTeamId);
  const grants = await assertPermission(tx, actorId, { module: "players", action, context: {
    clubId: row.clubId, leagueId: row.leagueId, seasonId: row.seasonId, teamId: row.teamId,
  } });
  return { row, grants };
}

/** Solo para servicios que ya autorizaron la inscripción; no concede acceso. */
export async function readLockedPlayerTeamContext(tx: Prisma.TransactionClient, seasonTeamId: string) {
  const rows = await tx.$queryRaw<{
    seasonTeamId: string; teamId: string; clubId: string; leagueId: string; seasonId: string;
    groupId: string; seasonCategoryId: string; categoryId: string;
    teamStatus: string; seasonStatus: string; affiliationStatus: string; categoryAuthorized: boolean; operational: boolean;
  }[]>`
    SELECT st.id AS "seasonTeamId", st.team_id AS "teamId", st.club_id AS "clubId",
      s.league_id AS "leagueId", st.season_id AS "seasonId", st.group_id AS "groupId",
      sc.id AS "seasonCategoryId", sc.category_id AS "categoryId", st.status AS "teamStatus",
      s.status AS "seasonStatus", ca.status AS "affiliationStatus",
      (c.status='ACTIVE' AND t.status='ACTIVE') AS operational,
      EXISTS (SELECT 1 FROM sports_management.club_affiliation_categories cac
        WHERE cac.affiliation_id = ca.id AND cac.season_id = s.id AND cac.category_id = sc.category_id
          AND cac.authorized_by IS NOT NULL AND cac.authorized_at IS NOT NULL) AS "categoryAuthorized"
    FROM sports_management.season_teams st
    JOIN sports_management.teams t ON t.id = st.team_id AND t.club_id = st.club_id
    JOIN sports_management.seasons s ON s.id = st.season_id
    JOIN sports_management.clubs c ON c.id = st.club_id AND c.league_id = s.league_id
    JOIN sports_management.club_affiliations ca ON ca.club_id = c.id AND ca.season_id = s.id
    JOIN sports_management.groups g ON g.id = st.group_id AND g.season_id = s.id
    JOIN sports_management.season_categories sc ON sc.id = g.season_category_id AND sc.season_id = s.id
    JOIN sports_management.categories cat ON cat.id = sc.category_id AND cat.league_id = s.league_id AND cat.sport_id = s.sport_id
    WHERE st.id = ${seasonTeamId}::uuid
    FOR SHARE OF st, t, s, c, ca, g, sc, cat
  `;
  if (!rows.length) throw new AuthorizationError();
  return rows[0];
}

export async function assertPlayerRegistrationRead(tx: Prisma.TransactionClient, actorId: string, registrationId: string,
  seasonTeamId: string) {
  const { row, grants } = await lockPlayerTeamContext(tx, actorId, seasonTeamId, "READ");
  // PLAYER:R* conserva el predicado de propiedad adicional de RF22.
  const playerRole = await tx.roles.findUnique({ where: { code: "PLAYER" }, select: { id: true } });
  if (grants.every(grant => grant.roleId === playerRole?.id))
    await assertOwnPlayerRegistration(tx, actorId, registrationId);
  return row;
}

export async function assertReusableIdentity(tx: Prisma.TransactionClient, actorId: string, personId: string,
  context: { clubId: string; leagueId: string }) {
  const ownIdentity = await tx.users.findFirst({ where: { id: actorId, person_id: personId }, select: { id: true } });
  if (ownIdentity) return;
  const grants = await getPermissionGrants(tx, actorId, "players", "READ");
  const playerRole = await tx.roles.findUnique({ where: { code: "PLAYER" }, select: { id: true } });
  const operationalGrants = grants.filter(grant => grant.roleId !== playerRole?.id);
  // Acceso de operación a la identidad en la liga, además de CREATE en el destino.
  if (operationalGrants.some(grant => !grant.contextOnly && !grant.clubId && !grant.leagueId)) return;
  const canReadClub=operationalGrants.some(grant=>
    (grant.clubId===context.clubId && (!grant.leagueId || grant.leagueId===context.leagueId)) ||
    (!grant.clubId && !grant.contextOnly && grant.leagueId===context.leagueId));
  // Una relación de directivo ya aprobada en el propio club permite reutilizar
  // Persona. No concede búsqueda pública de CURP, roles ni acceso a cuentas.
  if(canReadClub && await tx.club_officers.findFirst({where:{person_id:personId,club_affiliations:{club_id:context.clubId,league_id:context.leagueId,status:"APPROVED"}},select:{id:true}}))return;
  const prior = await tx.player_registrations.findFirst({ where: { person_id: personId,
    season_teams: { OR: [
      ...(operationalGrants.some(grant => grant.clubId === context.clubId &&
        (!grant.leagueId || grant.leagueId === context.leagueId)) ? [{ club_id: context.clubId }] : []),
      ...(operationalGrants.some(grant => !grant.contextOnly && !grant.clubId && grant.leagueId === context.leagueId)
        ? [{ teams: { clubs: { league_id: context.leagueId } } }] : []),
    ] } }, select: { id: true } });
  if (!prior) throw new PlayerRegistrationError("IDENTITY_UNAVAILABLE");
}
