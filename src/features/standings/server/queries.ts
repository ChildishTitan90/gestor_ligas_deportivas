import 'server-only';
import { Prisma } from '@prisma/client';
import { getPrisma } from '@/server/db/prisma';
import { requireOperationalUser } from '@/server/auth/session';
import { assertPermission, AuthorizationError, getPermissionGrants } from '@/server/auth/authorization';
import { standingFiltersSchema } from '../schemas';
import type { StandingCatalog, StandingWorkspace } from '../types';
import { eligibleResult } from '../calculation';
import { projectStandingsForActorInTransaction } from './service';

export class StandingFilterError extends Error {
  constructor() { super('INVALID_STANDING_FILTERS'); }
}
async function catalogForActor(tx: Prisma.TransactionClient, actorId: string): Promise<StandingCatalog> {
  const grants = (await getPermissionGrants(tx, actorId, 'competitions', 'READ'))
    .filter(grant => !grant.clubId && (grant.leagueId || !grant.contextOnly));
  if (!grants.length) throw new AuthorizationError();
  const global = grants.some(grant => !grant.leagueId);
  const competitions = await tx.leagues.findMany({
    where: { is_active: true, ...(global ? {} : { id: { in: grants.map(g => g.leagueId!) } }) },
    select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  const seasons = await tx.seasons.findMany({ where: { league_id: { in: competitions.map(c => c.id) }, sports: { code: 'SOCCER' } },
    select: { id: true, league_id: true, name: true }, orderBy: [{ start_date: 'desc' }, { id: 'asc' }] });
  const categories = await tx.season_categories.findMany({ where: { season_id: { in: seasons.map(s => s.id) } },
    select: { id: true, season_id: true, categories: { select: { name: true } } }, orderBy: [{ hierarchy_order: 'asc' }, { id: 'asc' }] });
  const groups = await tx.groups.findMany({ where: { season_category_id: { in: categories.map(c => c.id) } },
    select: { id: true, name: true, season_category_id: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  return { competitions, seasons: seasons.map(s => ({ id: s.id, competitionId: s.league_id, name: s.name })),
    categories: categories.map(c => ({ id: c.id, seasonId: c.season_id, name: c.categories.name })),
    groups: groups.map(g => ({ id: g.id, categoryId: g.season_category_id, name: g.name })) };
}
export async function canReadStandings() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => (await catalogForActor(tx, actor.id)).competitions.length > 0);
}
export async function getStandingWorkspace(input: unknown) {
  const actor = await requireOperationalUser();
  return getStandingWorkspaceForActor(actor.id, input);
}
/** Internal trusted entry; actorId is never accepted from search parameters or the browser. */
export async function getStandingWorkspaceForActor(actorId: string, input: unknown): Promise<StandingWorkspace> {
  const parsed = standingFiltersSchema.safeParse(input);
  if (!parsed.success) throw new StandingFilterError();
  const filters = parsed.data;
  return getPrisma().$transaction(async tx => {
    const catalog = await catalogForActor(tx, actorId);
    // Validate all submitted parents against the authorized server catalog, even when incomplete.
    if (filters.competitionId && !catalog.competitions.some(c => c.id === filters.competitionId)) throw new AuthorizationError();
    if (filters.seasonId && !catalog.seasons.some(s => s.id === filters.seasonId && s.competitionId === filters.competitionId)) throw new AuthorizationError();
    if (filters.categoryId && !catalog.categories.some(c => c.id === filters.categoryId && c.seasonId === filters.seasonId)) throw new AuthorizationError();
    const group = catalog.groups.find(g => g.id === filters.groupId && g.categoryId === filters.categoryId);
    if (filters.groupId && !group) throw new AuthorizationError();
    if (filters.competitionId) await assertPermission(tx, actorId, { module: 'competitions', action: 'READ', context: { leagueId: filters.competitionId } });
    if (filters.seasonId) await assertPermission(tx, actorId, { module: 'competitions', action: 'READ', context: { seasonId: filters.seasonId } });
    const matchdays = filters.seasonId ? await tx.matchdays.findMany({ where: { season_id: filters.seasonId },
      select: { id: true, number: true }, orderBy: [{ number: 'desc' }, { id: 'asc' }] }) : [];
    if (filters.matchdayId && !matchdays.some(d => d.id === filters.matchdayId)) throw new AuthorizationError();
    const base = { catalog, filters, matchdays, table: null };
    if (!group || !filters.seasonId || !filters.categoryId) return { ...base, state: 'select' };
    const matchdayId = filters.matchdayId ?? matchdays[0]?.id;
    if (!matchdayId) return { ...base, state: 'no-matchdays' };
    const matchday = matchdays.find(d => d.id === matchdayId)!;
    const category = await tx.season_categories.findUniqueOrThrow({ where: { id: filters.categoryId },
      select: { competition_rule_id: true, competition_rules: { select: { version_number: true } } } });
    let projection;
    try { projection = await projectStandingsForActorInTransaction(tx, actorId, { groupId: group.id, matchdayId }); }
    catch (error) {
      if (error instanceof Error && error.message === 'RULES_NOT_APPROVED') return { ...base, state: 'rules-pending' };
      throw error;
    }
    const latest = await tx.standing_versions.findFirst({ where: { group_id: group.id, matchday_id: matchdayId, competition_rule_id: category.competition_rule_id },
      select: { version_number: true, status: true, calculated_at: true, input_fingerprint: true }, orderBy: { version_number: 'desc' } });
    const saved = latest?.input_fingerprint === projection.fingerprint;
    const teams = await tx.season_teams.findMany({ where: { id: { in: projection.data.teamIds }, group_id: group.id, season_id: filters.seasonId },
      select: { id: true, teams: { select: { name: true } } } });
    const names = new Map(teams.map(t => [t.id, t.teams.name]));
    const official = projection.data.results.filter(eligibleResult);
    return { ...base, state: 'ready', table: {
      groupName: group.name, matchday: matchday.number, ruleVersion: category.competition_rules.version_number,
      version: saved ? latest!.version_number : null, latestStoredVersion: latest?.version_number ?? null,
      status: saved ? (latest!.status === 'VALIDATED' ? 'VALIDATED' : 'CALCULATED') : 'PREVIEW',
      calculatedAt: saved ? latest!.calculated_at.toISOString() : null, officialResults: official.length,
      sources: [['MATCH_REPORT', 'Cédula confirmada'], ['DEFAULT', 'Incomparecencia'], ['ADMINISTRATIVE', 'Resolución administrativa']].map(([code, label]) => ({ label, count: official.filter(r => r.source === code).length })),
      rows: projection.rows.map(({ teamId, played, won, drawn, lost, scoreFor, scoreAgainst, difference, points, rank }) =>
        ({ teamId, played, won, drawn, lost, scoreFor, scoreAgainst, difference, points, rank, teamName: names.get(teamId) ?? 'Equipo no disponible' })),
    } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
}
