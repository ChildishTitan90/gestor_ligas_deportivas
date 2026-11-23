import { storedProposalSchema } from "../stored-proposal";
import "server-only";
import {
  AuthorizationError,
  getPermissionGrants,
  grantCoversContext,
} from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";

async function proposalAccess() {
  const actor = await requireOperationalUser();
  const grants = await getPermissionGrants(getPrisma(), actor.id, "scheduling", "READ");
  const seasonGrants = grants.filter(grant => grantCoversContext(grant, {
    leagueId: grant.leagueId ?? undefined, clubIds: [], hasContext: true,
  }));
  const global = seasonGrants.some(grant => !grant.leagueId);
  const leagues = [...new Set(seasonGrants.flatMap(grant => grant.leagueId ? [grant.leagueId] : []))];
  return { actorId: actor.id, global, leagues };
}

export async function canReadScheduleProposals() {
  const { global, leagues } = await proposalAccess();
  return global || leagues.length > 0;
}

export async function listScheduleProposals() {
  const { actorId, global, leagues } = await proposalAccess();
  if (!global && !leagues.length) throw new AuthorizationError();

  const db = getPrisma();
  const [updates, approvals] = await Promise.all([
    getPermissionGrants(db, actorId, "scheduling", "UPDATE"),
    getPermissionGrants(db, actorId, "scheduling", "APPROVE"),
  ]);
  const proposals = await db.schedule_proposals.findMany({
    where: global ? {} : { seasons: { league_id: { in: leagues } } },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    select: {
      id: true,
      created_at: true,
      parameters: true,
      season_id: true,
      matchday_id: true,
      status: true,
      version: true,
      matchdays: { select: { number: true } },
      seasons: { select: { name: true, league_id: true, status: true, leagues: { select: { name: true, timezone: true, venues: { where: { is_active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } } } } } },
      competition_rules: { select: { version_number: true } },
      matches: {
        where: { deleted_at: null },
        orderBy: [{ starts_at: { sort: "asc", nulls: "last" } }, { number: "asc" }],
        select: {
          id: true,
          number: true,
          season_id: true,
          matchday_id: true,
          starts_at: true,
          version: true,
          match_statuses: { select: { name: true, code: true } },
          venues: { select: { name: true } },
          season_teams_matches_home_team_id_season_idToseason_teams: { select: { teams: { select: { name: true } } } },
          season_teams_matches_away_team_id_season_idToseason_teams: { select: { teams: { select: { name: true } } } },
          groups: { select: { name: true } },
        },
      },
    },
  });
  return { actorId, proposals: proposals.map(proposal => {
    const stored = storedProposalSchema.safeParse(proposal.parameters);
    const generated = stored.success ? {
      groupId: stored.data.groupId,
      categoryId: stored.data.categoryId,
      seasonVersion: stored.data.seasonVersion,
      matches: stored.data.matches.map((match, index) => ({
        encounterIndex: index, round: match.round, matchdayId: match.matchdayId,
        home: stored.data.teamNames?.[match.home] ?? "Equipo local",
        away: stored.data.teamNames?.[match.away] ?? "Equipo visitante",
        homeId: match.home, awayId: match.away,
        venueId: match.venueId,
        venue: match.venueId ? stored.data.venueNames?.[match.venueId] ?? "Cancha" : "Cancha pendiente",
        start: match.start, end: match.end, reservedUntil: match.reservedUntil,
        factors: "factors" in match && Array.isArray(match.factors) ? match.factors : [],
      })),
      byes: stored.data.byes.map(bye => ({
        round: bye.round, teamId: bye.teamId, team: stored.data.teamNames?.[bye.teamId] ?? "Equipo",
      })),
    } : null;
    const { parameters: _parameters, ...safeProposal } = proposal;
    void _parameters;
    const scope = { leagueId: proposal.seasons.league_id, clubIds: [], hasContext: true };
    const open = proposal.seasons.status !== "CLOSED";
    const canEdit = open && proposal.status === "DRAFT" && updates.some(grant => grantCoversContext(grant, scope));
    const canReview = open && proposal.status === "IN_REVIEW" && approvals.some(grant => grantCoversContext(grant, scope));
    return {
      ...safeProposal,
      generated,
      canEdit,
      canReview,
      operationalCount:proposal.matches.length,
      canActivate: open && proposal.status === "APPROVED" && stored.success && proposal.matches.length === 0 && approvals.some(grant => grantCoversContext(grant, scope)),
      // El vínculo al UUID de la propuesta no garantiza temporada ni jornada en PostgreSQL.
      matches: proposal.matches.filter(match =>
        match.season_id === proposal.season_id && match.matchday_id === proposal.matchday_id),
    };
  }) };
}
