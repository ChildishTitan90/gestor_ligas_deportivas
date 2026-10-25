import "server-only";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { enrollmentListSchema, enrollmentOptionsSchema } from "../team-enrollment";
import { getEnrollmentClubIds, lockEnrollmentSeason, TeamEnrollmentError } from "./team-enrollment-access";

export async function getTeamEnrollmentOptions(input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = enrollmentOptionsSchema.safeParse(input);
  if (!parsed.success) throw new TeamEnrollmentError("VALIDATION_ERROR");
  const { clubId, seasonId } = parsed.data;
  return getPrisma().$transaction(async (tx) => {
    const clubIds = await getEnrollmentClubIds(tx, actor.id);
    if (clubId && !clubIds.includes(clubId)) throw new AuthorizationError();
    const clubs = await tx.clubs.findMany({ where: { id: { in: clubIds }, status: "ACTIVE", leagues: { is_active: true } },
      select: { id: true, name: true, league_id: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    if (!clubId) return { clubs: clubs.map((c) => ({ id: c.id, name: c.name, leagueId: c.league_id })),
      teams: [], seasons: [], categories: [], groups: [] };
    await assertPermission(tx, actor.id, { module: "clubs", action: "CREATE", context: { clubId } });
    const club = clubs.find((item) => item.id === clubId);
    if (!club) throw new AuthorizationError();
    const teams = await tx.teams.findMany({ where: { club_id: clubId },
      select: { id: true, name: true, reference_number: true,
        season_teams: { select: { season_id: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    const seasons = await tx.seasons.findMany({ where: { league_id: club.league_id, sports: { code: "SOCCER" }, status: { not: "CLOSED" } },
      select: { id: true, name: true, status: true }, orderBy: [{ start_date: "desc" }, { id: "asc" }] });
    if (seasonId) await lockEnrollmentSeason(tx, clubId, seasonId);
    const affiliation = seasonId ? await tx.club_affiliations.findUnique({
      where: { club_id_season_id: { club_id: clubId, season_id: seasonId } }, select: { id: true, status: true },
    }) : null;
    const categories = seasonId && seasons.some((s) => s.id === seasonId) && affiliation?.status === "APPROVED"
      ? await tx.season_categories.findMany({ where: { season_id: seasonId,
        categories: { league_id: club.league_id, sports: { code: "SOCCER" } },
        club_affiliation_categories: { some: { affiliation_id: affiliation.id, authorized_by: { not: null }, authorized_at: { not: null } } } },
        select: { id: true, category_id: true, categories: { select: { name: true } },
          groups: { select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] } },
        orderBy: [{ hierarchy_order: "asc" }, { id: "asc" }] }) : [];
    return { clubs: clubs.map((c) => ({ id: c.id, name: c.name, leagueId: c.league_id })),
      teams: teams.map((team) => ({ id: team.id, clubId, name: team.name, referenceNumber: team.reference_number,
        enrolledSeasonIds: team.season_teams.map((row) => row.season_id) })), seasons,
      categories: categories.map((c) => ({ id: c.category_id, seasonCategoryId: c.id, seasonId: seasonId!, name: c.categories.name })),
      groups: categories.flatMap((c) => c.groups.map((g) => ({ id: g.id, name: g.name, categoryId: c.category_id, seasonId: seasonId! }))) };
  });
}

export async function listTeamEnrollments(input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = enrollmentListSchema.safeParse(input);
  if (!parsed.success) throw new TeamEnrollmentError("VALIDATION_ERROR");
  const { clubId, seasonId, after, limit } = parsed.data;
  return getPrisma().$transaction(async (tx) => {
    await assertPermission(tx, actor.id, { module: "clubs", action: "READ", context: { clubId } });
    if (seasonId) await lockEnrollmentSeason(tx, clubId, seasonId);
    const rows = await tx.season_teams.findMany({
      where: { club_id: clubId, ...(seasonId ? { season_id: seasonId } : {}), ...(after ? { id: { gt: after } } : {}) },
      select: { id: true, team_id: true, club_id: true, season_id: true, group_id: true, status: true,
        teams: { select: { name: true, reference_number: true } },
        groups: { select: { name: true, season_categories: { select: { category_id: true, categories: { select: { name: true } } } } } } },
      orderBy: { id: "asc" }, take: limit + 1,
    });
    return { items: rows.slice(0, limit).map((row) => ({ id: row.id, teamId: row.team_id, teamName: row.teams.name,
      teamReferenceNumber: row.teams.reference_number, clubId: row.club_id, seasonId: row.season_id,
      categoryId: row.groups.season_categories.category_id, categoryName: row.groups.season_categories.categories.name,
      groupId: row.group_id, groupName: row.groups.name, status: row.status })),
      nextAfter: rows.length > limit ? rows[limit - 1].id : null };
  });
}
