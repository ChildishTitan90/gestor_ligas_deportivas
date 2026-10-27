import "server-only";
import type { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, getPermissionGrants } from "@/server/auth/authorization";

export class TeamEnrollmentError extends Error {
  constructor(public readonly code: "VALIDATION_ERROR" | "INVALID_CONTEXT" |
    "AFFILIATION_NOT_APPROVED" | "CATEGORY_NOT_AUTHORIZED" | "SEASON_CLOSED" |
    "TEAM_ALREADY_ENROLLED" | "IDEMPOTENCY_CONFLICT" | "OPERATION_CANCELLED", public readonly status = 400) {
    super(code);
  }
}

/** Precondición de identidad de la vista, nunca una elección de actor/autoridad. */
export function assertEnrollmentActor(actorId: string, expectedActorId?: string) {
  if (expectedActorId !== undefined && expectedActorId.toLowerCase() !== actorId) throw new AuthorizationError();
}

export async function assertEnrollmentDelegate(tx: Prisma.TransactionClient, actorId: string, clubId: string) {
  // La primera inscripción aún no tiene season_teams. Autorizar por club y
  // comprobar después temporada, equipo, afiliación y categoría en la transacción.
  const grants = await assertPermission(tx, actorId, {
    module: "clubs", action: "CREATE", context: { clubId },
  });
  const role = await tx.roles.findUniqueOrThrow({ where: { code: "CLUB_DELEGATE" }, select: { id: true } });
  if (!grants.some((grant) => grant.roleId === role.id && grant.clubId === clubId)) throw new AuthorizationError();
}

export async function canEnrollForClub(tx: Prisma.TransactionClient, actorId: string, clubId: string) {
  try {
    await assertEnrollmentDelegate(tx, actorId, clubId);
    return true;
  } catch (error) {
    if (error instanceof AuthorizationError) return false;
    throw error;
  }
}

export async function readableEnrollmentClubs(tx: Prisma.TransactionClient, actorId: string,
  input: { clubId?: string; clubAfter?: string; limit: number }) {
  const grants = await getPermissionGrants(tx, actorId, "clubs", "READ");
  const unrestricted = grants.some(grant => !grant.contextOnly && !grant.clubId && !grant.leagueId);
  const scopes = grants.flatMap((grant): Prisma.clubsWhereInput[] => {
    if (grant.clubId) return [{ id: grant.clubId, ...(grant.leagueId ? { league_id: grant.leagueId } : {}) }];
    if (grant.leagueId) return [{ league_id: grant.leagueId }];
    return grant.contextOnly ? [] : [{}];
  });
  if (!scopes.length) throw new AuthorizationError();
  if (input.clubId) await assertPermission(tx, actorId, {
    module: "clubs", action: "READ", context: { clubId: input.clubId },
  });
  const rows = await tx.clubs.findMany({ where: { AND: [unrestricted ? {} : { OR: scopes },
    { status: "ACTIVE", leagues: { is_active: true } },
    ...(input.clubAfter ? [{ id: { gt: input.clubAfter } }] : [])] },
    select: { id: true, name: true, league_id: true }, orderBy: { id: "asc" }, take: input.limit + 1 });
  const selectedClub = input.clubId ? await tx.clubs.findUnique({ where: { id: input.clubId },
    select: { id: true, name: true, league_id: true } }) : null;
  return { clubs: rows.slice(0, input.limit), selectedClub,
    nextClubAfter: rows.length > input.limit ? rows[input.limit - 1].id : null };
}

export async function lockEnrollmentSeason(tx: Prisma.TransactionClient, clubId: string, seasonId: string) {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT s.status FROM sports_management.seasons s
    JOIN sports_management.clubs c ON c.league_id = s.league_id
    JOIN sports_management.sports sport ON sport.id = s.sport_id AND sport.code = 'SOCCER'
    WHERE c.id = ${clubId}::uuid AND s.id = ${seasonId}::uuid FOR SHARE OF s, c
  `;
  if (!rows.length) throw new TeamEnrollmentError("INVALID_CONTEXT");
  return rows[0];
}

export async function lockEnrollmentCategory(tx: Prisma.TransactionClient,
  data: { clubId: string; seasonId: string; categoryId: string; groupId: string }) {
  const affiliation = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status FROM sports_management.club_affiliations
    WHERE club_id = ${data.clubId}::uuid AND season_id = ${data.seasonId}::uuid FOR SHARE
  `;
  if (affiliation[0]?.status !== "APPROVED") throw new TeamEnrollmentError("AFFILIATION_NOT_APPROVED", 409);
  const category = await tx.$queryRaw<{ id: string }[]>`
    SELECT g.id FROM sports_management.groups g
    JOIN sports_management.season_categories sc ON sc.id = g.season_category_id AND sc.season_id = g.season_id
    JOIN sports_management.categories c ON c.id = sc.category_id
    JOIN sports_management.seasons s ON s.id = sc.season_id AND s.league_id = c.league_id AND s.sport_id = c.sport_id
    WHERE g.id = ${data.groupId}::uuid AND g.season_id = ${data.seasonId}::uuid
      AND c.id = ${data.categoryId}::uuid FOR SHARE OF g, sc, c
  `;
  if (!category.length) throw new TeamEnrollmentError("INVALID_CONTEXT");
  const authorization = await tx.$queryRaw<{ category_id: string }[]>`
    SELECT category_id FROM sports_management.club_affiliation_categories
    WHERE affiliation_id = ${affiliation[0].id}::uuid AND season_id = ${data.seasonId}::uuid
      AND category_id = ${data.categoryId}::uuid AND authorized_by IS NOT NULL AND authorized_at IS NOT NULL
    FOR SHARE
  `;
  if (!authorization.length) throw new TeamEnrollmentError("CATEGORY_NOT_AUTHORIZED", 409);
}
