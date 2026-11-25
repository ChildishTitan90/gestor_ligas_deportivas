export type StandingEvent = { id: string; matchId: string; reportId: string; reportVersion: number; reportSource?: string; code: string; teamId: string | null; playerId: string | null };
/** An observed zero is exact for this evidence set, not proof of complete capture. */
export function eventStatistics(events: StandingEvent[]) {
  const unique = new Map(events.map(e => [e.id, e]));
  if (unique.size !== events.length) throw Error('DUPLICATE_EVENT');
  const players = new Map<string, { playerId: string; teamId: string; goals: number; ownGoals: number; cautions: number; directDismissals: number; secondCautionDismissals: number; eventIds: string[] }>();
  const cautions = new Map<string, number>();
  for (const e of events) {
    if (!e.playerId || !e.teamId) continue;
    const key = `${e.playerId}:${e.teamId}`;
    const row = players.get(key) ?? { playerId: e.playerId, teamId: e.teamId, goals: 0, ownGoals: 0, cautions: 0, directDismissals: 0, secondCautionDismissals: 0, eventIds: [] };
    row.eventIds.push(e.id);
    if (e.code === 'GOAL') row.goals++;
    if (e.code === 'OWN_GOAL') row.ownGoals++;
    if (e.code === 'SENDING_OFF') row.directDismissals++;
    if (e.code === 'CAUTION') {
      row.cautions++;
      const gameKey = `${key}:${e.matchId}`, count = (cautions.get(gameKey) ?? 0) + 1;
      cautions.set(gameKey, count);
      if (count === 2) row.secondCautionDismissals++;
    }
    players.set(key, row);
  }
  return { players: [...players.values()].sort((a,b)=>`${a.playerId}:${a.teamId}`.localeCompare(`${b.playerId}:${b.teamId}`)), unattributedEventIds: events.filter(e=>!e.playerId || !e.teamId).map(e=>e.id), completeness: 'UNKNOWN' as const };
}
