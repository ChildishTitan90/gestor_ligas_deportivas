import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { reportAccess } from '@/features/match-reports/server/access';
import { isTransactionConflict } from '@/server/db/transaction-conflict';
import { getPrisma } from '@/server/db/prisma';
import { requireOperationalUser } from '@/server/auth/session';
import { assertPermission, lockAuthorization } from '@/server/auth/authorization';
import { eventStatistics, type StandingEvent } from '../event-statistics';
import { calculateStandings, eligibleResult, type ResultInput } from '../calculation';

const requestSchema = z.strictObject({ groupId: z.uuid(), matchdayId: z.uuid() });
const ruleSchema = z.strictObject({ points: z.strictObject({ win: z.number().int(), draw: z.number().int(), loss: z.number().int() }), tieBreakers: z.array(z.string().min(1)).min(1).refine(v => new Set(v).size === v.length) });
type Tx = Prisma.TransactionClient;
type Context = { seasonId: string; ruleId: string; number: number; seasonStatus: string };
async function context(tx: Tx, actorId: string, input: unknown, write: boolean, derived = false) {
  const { groupId, matchdayId } = requestSchema.parse(input);
  await lockAuthorization(tx);
  const [scope] = await tx.$queryRaw<Context[]>`SELECT g.season_id AS "seasonId", c.competition_rule_id AS "ruleId", d.number, s.status AS "seasonStatus"
    FROM sports_management.groups g JOIN sports_management.season_categories c ON c.id=g.season_category_id AND c.season_id=g.season_id
    JOIN sports_management.seasons s ON s.id=g.season_id
    JOIN sports_management.matchdays d ON d.season_id=g.season_id AND d.id=${matchdayId}::uuid WHERE g.id=${groupId}::uuid`;
  if (!scope) throw Error('INVALID_STANDING_CONTEXT');
  if (!derived) await assertPermission(tx, actorId, { module: 'competitions', action: write ? 'UPDATE' : 'READ', context: { seasonId: scope.seasonId } });
  if (write && scope.seasonStatus === 'CLOSED') throw Error('CLOSED_SEASON');
  return { ...scope, groupId, matchdayId };
}
/** Same engine and official-source policy for reads and materialization. No writes. */
async function projectStandings(tx: Tx, scope: Awaited<ReturnType<typeof context>>) {
  const { seasonId, groupId, ruleId } = scope;
  const [rule] = await tx.$queryRaw<{ status: string; approved: boolean }[]>`SELECT status, approved_at IS NOT NULL AND approved_by IS NOT NULL AS approved FROM sports_management.competition_rules WHERE id=${ruleId}::uuid AND season_id=${seasonId}::uuid`;
  const parameters = await tx.$queryRaw<{ key: string; value: unknown; pending: boolean; validated: boolean }[]>`SELECT parameter_key AS key, parameter_value AS value, requires_validation AS pending, validated_by IS NOT NULL AS validated FROM sports_management.competition_rule_parameters WHERE competition_rule_id=${ruleId}::uuid ORDER BY parameter_key`;
  if (rule?.status !== 'APPROVED' || !rule.approved || parameters.some(p => p.pending || !p.validated)) throw Error('RULES_NOT_APPROVED');
  const values = Object.fromEntries(parameters.map(p => [p.key, p.value]));
  const configuration = ruleSchema.parse({ points: values.points, tieBreakers: values.tieBreakers });
  const teams = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sports_management.season_teams WHERE group_id=${groupId}::uuid AND season_id=${seasonId}::uuid ORDER BY id`;
  const results = await tx.$queryRaw<ResultInput[]>`SELECT r.id, m.id AS "matchId", r.version, m.home_team_id AS home, m.away_team_id AS away,
    r.home_score AS "homeScore", r.away_score AS "awayScore", r.source, ms.code AS status, r.counts_in_standings AS counts,
    r.offending_team_id AS offender, mr.status AS "reportStatus"
    FROM sports_management.matches m JOIN sports_management.match_results r ON r.match_id=m.id
    JOIN sports_management.matchdays d ON d.id=m.matchday_id AND d.season_id=m.season_id
    JOIN sports_management.match_statuses ms ON ms.id=m.status_id
    LEFT JOIN sports_management.match_reports mr ON mr.match_id=m.id
    WHERE m.group_id=${groupId}::uuid AND m.season_id=${seasonId}::uuid AND d.number<=${scope.number} AND m.deleted_at IS NULL ORDER BY m.id`;
  const rows = calculateStandings(teams.map(t => t.id), results, configuration);
  const events = await tx.$queryRaw<StandingEvent[]>`SELECT e.id, m.id AS "matchId", mr.id AS "reportId", mr.version AS "reportVersion", mr.source AS "reportSource", et.code,
    e.season_team_id AS "teamId", l.registration_id AS "playerId"
    FROM sports_management.match_events e JOIN sports_management.event_types et ON et.id=e.event_type_id
    JOIN sports_management.match_reports mr ON mr.id=e.match_report_id
    JOIN sports_management.matches m ON m.id=mr.match_id JOIN sports_management.matchdays d ON d.id=m.matchday_id
    LEFT JOIN sports_management.lineups l ON l.id=e.lineup_id
    WHERE m.group_id=${groupId}::uuid AND m.season_id=${seasonId}::uuid AND d.number<=${scope.number} AND m.deleted_at IS NULL AND mr.status='CONFIRMED' ORDER BY e.id`;
  const eligible = results.filter(eligibleResult);
  const officialEvents = events.flatMap(e => {
    const result = eligible.find(r => r.matchId === e.matchId);
    return result ? [{ ...e, resultId: result.id, resultVersion: result.version, resultSource: result.source }] : [];
  });
  // Event totals are observed evidence, never a claim that an empty report proves zero.
  const statistics = teams.map(({ id }) => {
    const observed = officialEvents.filter(e => e.teamId === id);
    return { teamId: id, observedGoals: observed.filter(e => e.code === 'GOAL').length,
      observedOwnGoals: observed.filter(e => e.code === 'OWN_GOAL').length,
      observedCautions: observed.filter(e => e.code === 'CAUTION').length,
      observedDirectDismissals: observed.filter(e => e.code === 'SENDING_OFF').length,
      observedSecondCautionDismissals: eventStatistics(observed).players.reduce((n,p) => n + p.secondCautionDismissals,0),
      completeness: 'UNKNOWN', officialGoals: null, officialCautions: null, officialDismissals: null };
  });
  const data = { formatVersion: 1, engineVersion: 1, ruleId, configuration, teamIds: teams.map(t => t.id), results, events: officialEvents, statistics, playerStatistics: eventStatistics(officialEvents), rows };
  const fingerprint = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return { data, fingerprint, rows };
}

/** Internal read entry. The actor must come from the server; scope is reauthorized. */
export async function projectStandingsForActorInTransaction(tx: Tx, actorId: string, input: unknown) {
  const scope = await context(tx, actorId, input, false);
  return projectStandings(tx, scope);
}

/** Internal materialization only. Actor must be obtained on the server. Caller owns
 * one SERIALIZABLE transaction, including any official-result/status writes.
 * No nested transactions, network I/O, official validation or anonymous publication. */
export async function calculateStandingsInTransaction(tx: Tx, actorId: string, input: unknown) {
  const [isolation] = await tx.$queryRaw<{ level: string }[]>`SELECT current_setting('transaction_isolation') AS level`;
  if (isolation.level !== 'serializable') throw Error('STANDINGS_SERIALIZABLE_REQUIRED');
  const scope = await context(tx, actorId, input, true);
  return materializeStandings(tx, actorId, scope);
}

async function materializeStandings(tx: Tx, actorId: string, scope: Awaited<ReturnType<typeof context>>) {
  const { seasonId, groupId, matchdayId, ruleId } = scope;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${groupId},29))::text`;
  const { data, fingerprint, rows } = await projectStandings(tx, scope);
  const existing = await tx.$queryRaw<{ id: string; version: number; fingerprint: string | null }[]>`SELECT id,version_number AS version,input_fingerprint AS fingerprint FROM sports_management.standing_versions WHERE group_id=${groupId}::uuid AND matchday_id=${matchdayId}::uuid AND competition_rule_id=${ruleId}::uuid ORDER BY version_number DESC LIMIT 1`;
  if (existing[0]?.fingerprint === fingerprint) return { id: existing[0].id, version: existing[0].version, reused: true, data };
  await tx.$executeRaw`SELECT set_config('app.user_id',${actorId},true)`;
  await tx.$executeRaw`SELECT set_config('app.reason','PDGLD-29: cálculo derivado versionado',true)`;
  const [version] = await tx.$queryRaw<{ id: string; version: number }[]>`INSERT INTO sports_management.standing_versions(season_id,group_id,matchday_id,competition_rule_id,version_number,input_fingerprint,calculation_data)
    SELECT ${seasonId}::uuid,${groupId}::uuid,${matchdayId}::uuid,${ruleId}::uuid,coalesce(max(version_number),0)+1,${fingerprint},${JSON.stringify(data)}::jsonb
    FROM sports_management.standing_versions WHERE group_id=${groupId}::uuid AND matchday_id=${matchdayId}::uuid RETURNING id,version_number AS version`;
  for (const row of rows) await tx.$executeRaw`INSERT INTO sports_management.standing_entries(standing_version_id,group_id,season_id,season_team_id,rank,played,won,drawn,lost,score_for,score_against,points)
    VALUES(${version.id}::uuid,${groupId}::uuid,${seasonId}::uuid,${row.teamId}::uuid,${row.rank}::integer,${row.played},${row.won},${row.drawn},${row.lost},${row.scoreFor},${row.scoreAgainst},${row.points})`;
  return { ...version, reused: false, data };
}
/** Derived effect of an authorized confirmation, never a general competitions write.
 * All scope and official evidence are read from this transaction, not the command.
 * Reauthorizes capture (including effective referee assignment) after finalization. */
export async function calculateConfirmedReportStandingsInTransaction(tx: Tx, actorId: string, reportId: string) {
  const [isolation] = await tx.$queryRaw<{ level: string }[]>`SELECT current_setting('transaction_isolation') AS level`;
  if (isolation.level !== 'serializable') throw Error('STANDINGS_SERIALIZABLE_REQUIRED');
  const report = await tx.match_reports.findUniqueOrThrow({ where: { id: z.uuid().parse(reportId) }, select: { match_id: true, status: true, confirmed_at: true } });
  const match = await reportAccess(tx, actorId, report.match_id, 'UPDATE');
  const source = await tx.matches.findUniqueOrThrow({ where: { id: match.id }, select: { group_id: true, matchday_id: true } });
  const result = await tx.match_results.findUnique({ where: { match_id: match.id }, select: { source: true, counts_in_standings: true } });
  if (report.status !== 'CONFIRMED' || !report.confirmed_at || match.match_statuses.code !== 'FINISHED' || result?.source !== 'MATCH_REPORT' || !result.counts_in_standings) throw Error('CONFIRMED_RESULT_REQUIRED');
  if (!source.group_id || !source.matchday_id) throw Error('INVALID_STANDING_CONTEXT');
  const scope = await context(tx, actorId, { groupId: source.group_id, matchdayId: source.matchday_id }, true, true);
  // Refresh existing later cuts too: late confirmation must not leave saved tables stale.
  const later = await tx.$queryRaw<{ id: string }[]>`SELECT DISTINCT d.id,d.number FROM sports_management.standing_versions v
    JOIN sports_management.matchdays d ON d.id=v.matchday_id AND d.season_id=v.season_id
    WHERE v.group_id=${scope.groupId}::uuid AND d.number>${scope.number} ORDER BY d.number,d.id`;
  const receipts = [await materializeStandings(tx, actorId, scope)];
  for (const day of later) receipts.push(await materializeStandings(tx, actorId,
    await context(tx, actorId, { groupId: scope.groupId, matchdayId: day.id }, true, true)));
  return receipts;
}

export async function calculateGroupStandings(input: unknown) {
  const actor = await requireOperationalUser();
  return calculateForActor(actor.id, input);
}
/** Trusted server entry; reauthorizes inside each retry. No client actor ID. */
export async function calculateForActor(actorId: string, input: unknown) {
  for (let attempt = 0; ; attempt++) {
    try { return await getPrisma().$transaction(tx => calculateStandingsInTransaction(tx, actorId, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 }); }
    catch (error) {
      if (attempt >= 4 || !isTransactionConflict(error)) throw error;
    }
  }
}
export async function readStandingsForActor(actorId: string, input: unknown) {
  return getPrisma().$transaction(async tx => {
    const scope = await context(tx, actorId, input, false);
    // Same rule as the category; versions for former rules stay historical.
    return tx.$queryRaw<{ id: string; version: number; status: string; calculatedAt: Date; data: unknown }[]>`SELECT id,version_number AS version,status,calculated_at AS "calculatedAt",calculation_data AS data FROM sports_management.standing_versions
      WHERE group_id=${scope.groupId}::uuid AND matchday_id=${scope.matchdayId}::uuid AND competition_rule_id=${scope.ruleId}::uuid ORDER BY version_number DESC`;
  });
}
export async function getGroupStandings(input: unknown) { const actor = await requireOperationalUser(); return readStandingsForActor(actor.id, input); }
