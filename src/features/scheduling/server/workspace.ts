import "server-only";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError, getPermissionGrants, type PermissionGrant } from "@/server/auth/authorization";

function permitsCalendar(grant: PermissionGrant) {
  return !grant.clubId && Boolean(grant.leagueId || !grant.contextOnly);
}

export async function canGenerateSchedule() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx =>
    (await getPermissionGrants(tx, actor.id, "scheduling", "CREATE")).some(permitsCalendar));
}

export async function getSchedulingWorkspace() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    const grants = (await getPermissionGrants(tx, actor.id, "scheduling", "CREATE"))
      .filter(permitsCalendar);
    if (!grants.length) throw new AuthorizationError();
    const global = grants.some(g => !g.leagueId);
    const seasons = await tx.seasons.findMany({
      where: { status: { not: "CLOSED" }, leagues: { is_active: true },
        ...(global ? {} : { league_id: { in: grants.map(g => g.leagueId!) } }) },
      select: { id: true, name: true, version: true, leagues: { select: { name: true, timezone: true, venues: { select: { id: true, name: true } } } } },
      orderBy: { start_date: "desc" },
    });
    const result = [];
    for (const season of seasons) {
      try {
        const permitted = await assertPermission(tx, actor.id, { module: "scheduling", action: "CREATE", context: { seasonId: season.id } });
        if (!permitted.some(g => !g.clubId)) continue;
      } catch (error) { if (error instanceof AuthorizationError) continue; throw error; }
      const groups = await tx.groups.findMany({ where: { season_id: season.id }, select: { id: true, name: true, season_category_id: true,
        season_teams: { select: { id: true, teams: { select: { name: true } } } },
        season_categories: { select: { categories: { select: { name: true } } } } } });
      result.push({ id: season.id, name: season.name, version: season.version, league: season.leagues.name,
        venueNames: Object.fromEntries(season.leagues.venues.map(venue => [venue.id, venue.name])),
        timezone: season.leagues.timezone, groups: groups.map(g => ({ id: g.id, name: g.name,
          teamNames: Object.fromEntries(g.season_teams.map(enrollment => [enrollment.id, enrollment.teams.name])),
          categoryId: g.season_category_id, category: g.season_categories.categories.name })) });
    }
    return { actorId: actor.id, seasons: result };
  });
}
