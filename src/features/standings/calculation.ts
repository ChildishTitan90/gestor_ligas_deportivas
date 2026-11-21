export type StandingRule = { points: { win: number; draw: number; loss: number }; tieBreakers: string[] };
export type ResultInput = { id: string; matchId: string; version: number; home: string; away: string; homeScore: number; awayScore: number; source: string; status: string; counts: boolean; offender: string | null; reportStatus: string | null };
export type StandingRow = { teamId: string; played: number; won: number; drawn: number; lost: number; scoreFor: number; scoreAgainst: number; difference: number; points: number; rank: number | null; unresolved: string | null };
export function eligibleResult(r: ResultInput) {
  if (!r.counts) return false;
  return r.source === 'MATCH_REPORT' ? r.status === 'FINISHED' && r.reportStatus === 'CONFIRMED'
    : r.source === 'DEFAULT' ? ['NO_SHOW', 'ADMINISTRATIVELY_RESOLVED'].includes(r.status)
    : r.source === 'ADMINISTRATIVE' && r.status === 'ADMINISTRATIVELY_RESOLVED';
}
/** Rebuild from official inputs; never add deltas to a previous standing. */
export function calculateStandings(teams: string[], results: ResultInput[], rule: StandingRule): StandingRow[] {
  if (new Set(teams).size !== teams.length) throw Error('DUPLICATE_TEAM');
  const rows = new Map(teams.map(teamId => [teamId, { teamId, played: 0, won: 0, drawn: 0, lost: 0, scoreFor: 0, scoreAgainst: 0, difference: 0, points: 0, rank: null, unresolved: null } as StandingRow]));
  const seen = new Set<string>();
  for (const r of results.filter(eligibleResult)) {
    if (seen.has(r.matchId)) throw Error('DUPLICATE_OFFICIAL_RESULT');
    seen.add(r.matchId);
    const home = rows.get(r.home), away = rows.get(r.away);
    if (!home || !away || r.home === r.away) throw Error('RESULT_OUTSIDE_GROUP');
    let hs = r.homeScore, as = r.awayScore;
    if (![hs, as].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('INVALID_SCORE');
    if (r.source === 'DEFAULT') {
      if (![r.home, r.away].includes(r.offender ?? '')) throw Error('DEFAULT_OFFENDER_REQUIRED');
      hs = r.offender === r.home ? 0 : 1; as = 1 - hs;
      // Official source must already record the administrative score; do not silently repair it.
      if (hs !== r.homeScore || as !== r.awayScore) throw Error('INVALID_DEFAULT_SCORE');
    }
    for (const [team, gf, gc] of [[home, hs, as], [away, as, hs]] as const) {
      team.played++; team.scoreFor += gf; team.scoreAgainst += gc;
      if (gf > gc) { team.won++; team.points += r.source === 'DEFAULT' ? 3 : rule.points.win; }
      else if (gf < gc) { team.lost++; team.points += r.source === 'DEFAULT' ? 0 : rule.points.loss; }
      else { team.drawn++; team.points += rule.points.draw; }
      team.difference = team.scoreFor - team.scoreAgainst;
    }
  }
  // Unknown criteria stop refinement: never skip gol average to apply a later criterion.
  function rankBucket(bucket: StandingRow[], criteria: string[], offset: number): StandingRow[] {
    if (bucket.length === 1) { bucket[0].rank = offset + 1; return bucket; }
    const criterion = criteria[0];
    const field = new Map<string, 'points' | 'difference' | 'scoreFor' | 'won'>([['POINTS', 'points'], ['GOAL_DIFFERENCE', 'difference'], ['GOALS_FOR', 'scoreFor'], ['WINS', 'won']]).get(criterion);
    if (!field) { for (const row of bucket) row.unresolved = criterion ? `UNSUPPORTED_TIE_BREAKER:${criterion}` : 'UNRESOLVED_TIE'; return bucket.sort((a,b) => a.teamId.localeCompare(b.teamId)); }
    const values = [...new Set(bucket.map(row => row[field]))].sort((a,b) => b-a);
    return values.flatMap(value => { const part = bucket.filter(row => row[field] === value); const sorted = rankBucket(part, criteria.slice(1), offset); offset += part.length; return sorted; });
  }
  return rankBucket([...rows.values()], ['POINTS', ...rule.tieBreakers], 0);
}
