import "server-only";

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "./session";

export const permissionActions = ["CREATE", "READ", "UPDATE", "APPROVE", "PUBLISH", "IMPORT"] as const;
export type PermissionAction = typeof permissionActions[number];

/** RF22 has one authority boundary for accounts, roles and permission policy. */
export const authorityPermissionModules = ["users"] as const;
export function isAuthorityPermissionModule(module: string): boolean {
  return (authorityPermissionModules as readonly string[]).includes(module);
}

/** Resource identifiers are hints to verify against PostgreSQL, never trusted scope. */
export type AuthorizationContext = {
  leagueId?: string;
  clubId?: string;
  seasonId?: string;
  /** teams.id, not season_teams.id. */
  teamId?: string;
  matchId?: string;
};

export type PermissionRequest = {
  module: string;
  action: PermissionAction;
  context: AuthorizationContext;
};

export type PermissionGrant = {
  assignmentId: string;
  roleId: string;
  permissionId: string;
  module: string;
  action: PermissionAction;
  contextOnly: boolean;
  leagueId: string | null;
  clubId: string | null;
  startsAt: Date;
  endsAt: Date | null;
};

export type ResolvedAuthorizationContext = {
  leagueId?: string;
  clubIds: readonly string[];
  seasonId?: string;
  teamId?: string;
  matchId?: string;
  hasContext: boolean;
};

export class AuthorizationError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";
  constructor() { super("FORBIDDEN"); }
}

const contextSchema = z.strictObject({
  leagueId: z.uuid().optional(), clubId: z.uuid().optional(), seasonId: z.uuid().optional(),
  teamId: z.uuid().optional(), matchId: z.uuid().optional(),
});
const permissionSchema = z.strictObject({
  module: z.string().min(1).max(120), action: z.enum(permissionActions), context: contextSchema,
});

/** All authorization-sensitive writers must take this lock exclusively first. */
export async function lockAuthorization(tx: Prisma.TransactionClient, mode: "shared" | "exclusive" = "shared") {
  if (mode === "exclusive") await tx.$queryRaw`SELECT pg_advisory_xact_lock(54, 2026)::text`;
  else await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(54, 2026)::text`;
}

async function assertOperationalActor(tx: Prisma.TransactionClient, actorId: string) {
  if (!z.uuid().safeParse(actorId).success) throw new AuthorizationError();
  const users = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM sports_management.users
    WHERE id = ${actorId}::uuid AND is_active AND NOT must_change_password
      AND (locked_until IS NULL OR locked_until <= clock_timestamp())
    FOR SHARE
  `;
  if (!users.length) throw new AuthorizationError();
}

/** Trusted server callers only: actorId must come from requireOperationalUser(). */
export async function getPermissionGrants(
  tx: Prisma.TransactionClient, actorId: string, module: string, action: PermissionAction,
): Promise<PermissionGrant[]> {
  if (!permissionSchema.safeParse({ module, action, context: {} }).success) throw new AuthorizationError();
  await lockAuthorization(tx);
  await assertOperationalActor(tx, actorId);
  return tx.$queryRaw<PermissionGrant[]>`
    SELECT ur.id AS "assignmentId", ur.role_id AS "roleId", p.id AS "permissionId",
      p.module, p.action, rp.context_only AS "contextOnly", ur.league_id AS "leagueId",
      ur.club_id AS "clubId", ur.starts_at AS "startsAt", ur.ends_at AS "endsAt"
    FROM sports_management.user_roles ur
    JOIN sports_management.roles r ON r.id = ur.role_id
    JOIN sports_management.role_permissions rp ON rp.role_id = ur.role_id
    JOIN sports_management.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ${actorId}::uuid AND p.module = ${module} AND p.action = ${action}
      AND ur.starts_at <= clock_timestamp() AND (ur.ends_at IS NULL OR ur.ends_at > clock_timestamp())
      AND (ur.league_id IS NULL OR EXISTS (
        SELECT 1 FROM sports_management.leagues l WHERE l.id = ur.league_id AND l.is_active))
      AND (ur.club_id IS NULL OR EXISTS (
        SELECT 1 FROM sports_management.clubs c JOIN sports_management.leagues l ON l.id = c.league_id
        WHERE c.id = ur.club_id AND c.status = 'ACTIVE' AND l.is_active
          AND (ur.league_id IS NULL OR ur.league_id = c.league_id)))
    FOR SHARE OF ur, r, rp, p
  `;
}

/** Resolve every supplied resource and reject inconsistent or nonexistent combinations. */
export async function resolveAuthorizationContext(
  tx: Prisma.TransactionClient, input: AuthorizationContext,
): Promise<ResolvedAuthorizationContext> {
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success) throw new AuthorizationError();
  const context = parsed.data;
  let leagueId = context.leagueId;
  let clubIds = context.clubId ? [context.clubId] : [];
  let seasonId = context.seasonId;
  let matchTeamIds: string[] | undefined;
  const setLeague = (id: string) => {
    if (leagueId && leagueId !== id) throw new AuthorizationError();
    leagueId = id;
  };
  const setClub = (id: string) => {
    if (clubIds.length && !clubIds.includes(id)) throw new AuthorizationError();
    clubIds = [id];
  };

  if (context.matchId) {
    const matches = await tx.$queryRaw<{
      seasonId: string; leagueId: string; homeTeamId: string; awayTeamId: string;
      homeClubId: string; awayClubId: string;
    }[]>`
      SELECT m.season_id AS "seasonId", s.league_id AS "leagueId",
        ht.team_id AS "homeTeamId", at.team_id AS "awayTeamId",
        ht.club_id AS "homeClubId", at.club_id AS "awayClubId"
      FROM sports_management.matches m JOIN sports_management.seasons s ON s.id = m.season_id
      JOIN sports_management.season_teams ht ON ht.id = m.home_team_id AND ht.season_id = m.season_id
      JOIN sports_management.season_teams at ON at.id = m.away_team_id AND at.season_id = m.season_id
      WHERE m.id = ${context.matchId}::uuid AND m.deleted_at IS NULL
      FOR SHARE OF m, s, ht, at
    `;
    const match = matches[0];
    if (!match || (seasonId && seasonId !== match.seasonId)) throw new AuthorizationError();
    seasonId = match.seasonId;
    setLeague(match.leagueId);
    const participants = [match.homeClubId, match.awayClubId];
    if (clubIds.length && !clubIds.every((id) => participants.includes(id))) throw new AuthorizationError();
    if (!clubIds.length) clubIds = [...new Set(participants)];
    matchTeamIds = [match.homeTeamId, match.awayTeamId];
  }
  if (seasonId) {
    const seasons = await tx.$queryRaw<{ leagueId: string }[]>`
      SELECT league_id AS "leagueId" FROM sports_management.seasons WHERE id = ${seasonId}::uuid FOR SHARE
    `;
    if (!seasons.length) throw new AuthorizationError();
    setLeague(seasons[0].leagueId);
  }
  if (context.teamId) {
    const teams = await tx.$queryRaw<{ clubId: string; leagueId: string }[]>`
      SELECT t.club_id AS "clubId", c.league_id AS "leagueId"
      FROM sports_management.teams t JOIN sports_management.clubs c ON c.id = t.club_id
      WHERE t.id = ${context.teamId}::uuid AND c.status = 'ACTIVE' FOR SHARE OF t, c
    `;
    if (!teams.length || (matchTeamIds && !matchTeamIds.includes(context.teamId))) throw new AuthorizationError();
    setClub(teams[0].clubId);
    setLeague(teams[0].leagueId);
    if (seasonId) {
      const memberships = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sports_management.season_teams
        WHERE team_id = ${context.teamId}::uuid AND season_id = ${seasonId}::uuid FOR SHARE
      `;
      if (!memberships.length) throw new AuthorizationError();
    }
  }
  for (const clubId of clubIds) {
    const clubs = await tx.$queryRaw<{ leagueId: string }[]>`
      SELECT league_id AS "leagueId" FROM sports_management.clubs
      WHERE id = ${clubId}::uuid AND status = 'ACTIVE' FOR SHARE
    `;
    if (!clubs.length) throw new AuthorizationError();
    setLeague(clubs[0].leagueId);
  }
  if (context.clubId && seasonId && !context.matchId && !context.teamId) {
    const affiliations = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sports_management.club_affiliations
      WHERE club_id = ${context.clubId}::uuid AND season_id = ${seasonId}::uuid FOR SHARE
    `;
    if (!affiliations.length) throw new AuthorizationError();
  }
  if (leagueId) {
    const leagues = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sports_management.leagues WHERE id = ${leagueId}::uuid AND is_active FOR SHARE
    `;
    if (!leagues.length) throw new AuthorizationError();
  }
  return { leagueId, clubIds, seasonId, teamId: context.teamId, matchId: context.matchId,
    hasContext: Object.values(context).some((id) => id !== undefined) };
}

/** Never combine one role's permission with another assignment's scope. */
export function grantCoversContext(grant: PermissionGrant, context: ResolvedAuthorizationContext): boolean {
  if (!context.hasContext) return !grant.contextOnly && !grant.leagueId && !grant.clubId;
  if (grant.leagueId && grant.leagueId !== context.leagueId) return false;
  if (grant.clubId && !context.clubIds.includes(grant.clubId)) return false;
  // A context-only assignment without a concrete scope cannot assert ownership.
  if (grant.contextOnly && !grant.leagueId && !grant.clubId) return false;
  return true;
}

export async function assertPermission(
  tx: Prisma.TransactionClient, actorId: string, request: PermissionRequest,
): Promise<PermissionGrant[]> {
  if (!permissionSchema.safeParse(request).success) throw new AuthorizationError();
  const grants = await getPermissionGrants(tx, actorId, request.module, request.action);
  const context = await resolveAuthorizationContext(tx, request.context);
  const permitted = grants.filter((grant) => grantCoversContext(grant, context));
  if (!permitted.length) throw new AuthorizationError();
  return permitted;
}

/** Identity always comes from the server. For writes, prefer assertPermission inside the write transaction. */
export async function requirePermission(request: PermissionRequest) {
  const actor = await requireOperationalUser();
  await getPrisma().$transaction((tx) => assertPermission(tx, actor.id, request));
  return actor;
}

/** users:UPDATE changes authority; users:CREATE alone cannot delegate a role. */
export async function assertCanGrantRole(
  tx: Prisma.TransactionClient, actorId: string, roleId: string, context: AuthorizationContext,
) {
  if (!z.uuid().safeParse(roleId).success || context.seasonId || context.teamId || context.matchId)
    throw new AuthorizationError();
  const delegation = await assertPermission(tx, actorId, { module: "users", action: "UPDATE", context });
  // The current account contract creates an assignment with no end date. A temporary
  // delegator cannot turn finite authority into a permanent grant.
  if (!delegation.some((grant) => grant.endsAt === null)) throw new AuthorizationError();
  const roles = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM sports_management.roles WHERE id = ${roleId}::uuid FOR SHARE
  `;
  if (!roles.length) throw new AuthorizationError();
  const permissions = await tx.$queryRaw<{ module: string; action: PermissionAction; contextOnly: boolean }[]>`
    SELECT p.module, p.action, rp.context_only AS "contextOnly"
    FROM sports_management.role_permissions rp JOIN sports_management.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ${roleId}::uuid FOR SHARE OF rp, p
  `;
  const resolved = await resolveAuthorizationContext(tx, context);
  let operationalApproval: PermissionGrant[] | undefined;
  for (const permission of permissions) {
    const grants = await getPermissionGrants(tx, actorId, permission.module, permission.action);
    // Direct backing uses the target assignment's complete scope and duration.
    const allowed = grants.some((grant) => grant.endsAt === null && grantCoversContext(grant, resolved));
    if (allowed) continue;
    // RF22 distinguishes approving operational role assignments from performing
    // their operations. This explicit capability cannot create control-plane
    // authority the actor does not already hold.
    if (isAuthorityPermissionModule(permission.module)) throw new AuthorizationError();
    operationalApproval ??= await getPermissionGrants(tx, actorId, "users", "APPROVE");
    if (!operationalApproval.some((grant) => grant.endsAt === null && grantCoversContext(grant, resolved)))
      throw new AuthorizationError();
  }
}
