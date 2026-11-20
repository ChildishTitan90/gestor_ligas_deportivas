type Match = { round: number; matchdayId: string; home: string; away: string };

/** Permuta ambos equipos en todas las jornadas; el partido entre ellos se conserva. */
export function proposeTeamSwap<T extends Match>(matches: readonly T[], round: number, first: string, second: string) {
  if (first === second) throw new Error("INVALID_TEAM_SWAP");
  const day = matches.filter(match => match.round === round);
  const firstMatch = day.find(match => match.home === first || match.away === first);
  const secondMatch = day.find(match => match.home === second || match.away === second);
  if (!firstMatch || !secondMatch || firstMatch === secondMatch) throw new Error("INVALID_TEAM_SWAP");
  const swap = (team: string) => team === first ? second : team === second ? first : team;
  return matches.map((match, index) => {
    const both = [match.home, match.away].includes(first) && [match.home, match.away].includes(second);
    const home = both ? match.home : swap(match.home), away = both ? match.away : swap(match.away);
    return { index, before: match, home, away, changed: home !== match.home || away !== match.away };
  });
}
