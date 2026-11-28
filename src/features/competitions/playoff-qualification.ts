import { z } from "zod";

/** Each knockout round independently selects one match or home-and-away. */
export const playoffFormatSchema = z.strictObject({
  quarterfinals: z.enum(["SINGLE", "HOME_AND_AWAY"]),
  semifinals: z.enum(["SINGLE", "HOME_AND_AWAY"]),
  final: z.enum(["SINGLE", "HOME_AND_AWAY"]),
});
export type PlayoffFormat = z.infer<typeof playoffFormatSchema>;
/** One shared tiebreaker for quarterfinals and semifinals; the final uses penalties. */
export const playoffRulesSchema = z.strictObject({
  format: playoffFormatSchema,
  preliminaryTiebreaker: z.enum(["STANDING_POSITION", "PENALTIES"]),
  venuePolicy: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("HOME") }),
    z.strictObject({ mode: z.literal("NEUTRAL"), venueIds: z.array(z.uuid()).min(1).max(50).refine(ids => new Set(ids).size === ids.length) }),
  ]).optional(),
});

export function tiedPlayoffResolution(round: "QUARTERFINAL" | "SEMIFINAL" | "FINAL", criterion: "STANDING_POSITION" | "PENALTIES", firstPosition: number | null, secondPosition: number | null) {
  if (round === "FINAL" || criterion === "PENALTIES") return { kind: "PENALTIES" as const };
  if (firstPosition === null || secondPosition === null || !Number.isSafeInteger(firstPosition) || !Number.isSafeInteger(secondPosition) || firstPosition < 1 || secondPosition < 1)
    return { kind: "POSITION_UNRESOLVED" as const };
  if (firstPosition === secondPosition) return { kind: "PENALTIES" as const };
  return { kind: "ADVANCES" as const, side: firstPosition < secondPosition ? "FIRST" as const : "SECOND" as const };
}

/** Los cruces se proponen solo después de clasificar y confirmar ambas tablas. */
export function singleGroupQuarterfinals(groups: PlayoffGroup[]) {
  if (groups.length !== 1) return { ok: false as const, code: "ONE_GROUP_REQUIRED" as const };
  const qualification = qualifyForPlayoffs(groups);
  if (!qualification.ok) return qualification;
  const team = (rank: number) => qualification.qualified.find(item => item.rank === rank)!.teamId;
  return { ok: true as const, pairings: [[team(1), team(8)], [team(4), team(5)], [team(2), team(7)], [team(3), team(6)]] };
}

export function twoGroupQuarterfinals(groups: PlayoffGroup[]) {
  if (groups.length !== 2) return { ok: false as const, code: "TWO_GROUPS_REQUIRED" as const };
  const qualification = qualifyForPlayoffs(groups);
  if (!qualification.ok) return qualification;
  const [a, b] = groups;
  const team = (groupId: string, rank: number) => qualification.qualified.find(item => item.groupId === groupId && item.rank === rank)!.teamId;
  return { ok: true as const, pairings: [[team(a.id, 1), team(b.id, 2)], [team(b.id, 1), team(a.id, 2)],
    [team(a.id, 3), team(b.id, 4)], [team(b.id, 3), team(a.id, 4)]] };
}

/** The caller supplies a permutation drawn and recorded by the authorized service. */
export function drawQuarterfinals(groups: PlayoffGroup[], order: string[]) {
  if (![4, 8].includes(groups.length)) return { ok: false as const, code: "DRAW_GROUP_COUNT" as const };
  const qualification = qualifyForPlayoffs(groups);
  if (!qualification.ok) return qualification;
  if (order.length !== groups.length || new Set(order).size !== groups.length || order.some(id => !groups.some(group => group.id === id)))
    return { ok: false as const, code: "INVALID_DRAW" as const };
  const team = (groupId: string, rank: number) => qualification.qualified.find(item => item.groupId === groupId && item.rank === rank)!.teamId;
  const pairings: string[][] = [];
  for (let i = 0; i < order.length; i += 2) {
    pairings.push([team(order[i], 1), team(order[i + 1], groups.length === 4 ? 2 : 1)]);
    if (groups.length === 4) pairings.push([team(order[i + 1], 1), team(order[i], 2)]);
  }
  return { ok: true as const, pairings };
}

/** Semifinals follow the confirmed bracket: QF 1 vs 2 and QF 3 vs 4. */
export function semifinalBracket(winners: string[]) {
  if (winners.length !== 4 || new Set(winners).size !== 4) return { ok: false as const, code: "INVALID_WINNERS" as const };
  return { ok: true as const, pairings: [[winners[0], winners[1]], [winners[2], winners[3]]] };
}

/** A proposal contains the entire fixed path, but does not create official matches. */
export function proposePlayoffBracket(groups: PlayoffGroup[], groupOrder?: string[]) {
  const quarterfinals = groups.length === 1 ? singleGroupQuarterfinals(groups)
    : groups.length === 2 ? twoGroupQuarterfinals(groups)
    : drawQuarterfinals(groups, groupOrder ?? []);
  if (!quarterfinals.ok) return quarterfinals;
  return { ok: true as const, rounds: {
    quarterfinals: quarterfinals.pairings.map((teams, index) => ({ number: index + 1, teams, winnerTo: Math.floor(index / 2) + 1 })),
    semifinals: [1, 2].map(number => ({ number, sources: [number * 2 - 1, number * 2], winnerTo: 1 })),
    final: { number: 1, sources: [1, 2] },
  } };
}
export function playoffDatesRequired(format: PlayoffFormat) {
  return Object.values(format).reduce((total, round) => total + (round === "HOME_AND_AWAY" ? 2 : 1), 0);
}

/** Mantiene la fecha de cada vuelta asociada a su ronda incluso en formatos mixtos. */
export function playoffRoundDates(format: PlayoffFormat, dates: string[]) {
  if (!playoffFormatSchema.safeParse(format).success || dates.length !== playoffDatesRequired(format) ||
      dates.some((date, index) => !z.iso.date().safeParse(date).success || (index > 0 && date <= dates[index - 1])))
    return { ok: false as const, code: "INVALID_PLAYOFF_DATES" as const };
  let offset = 0;
  const result = {} as Record<keyof PlayoffFormat, string[]>;
  for (const round of ["quarterfinals", "semifinals", "final"] as const) {
    const length = format[round] === "HOME_AND_AWAY" ? 2 : 1;
    result[round] = dates.slice(offset, offset + length);
    offset += length;
  }
  return { ok: true as const, dates: result };
}

/** Un empate de posición entre grupos no establece por sí mismo una localía. */
export function playoffHomeOrder(first: { teamId: string; rank: number }, second: { teamId: string; rank: number }, format: PlayoffFormat[keyof PlayoffFormat]) {
  if (!first.teamId || !second.teamId || first.teamId === second.teamId || !Number.isSafeInteger(first.rank) || !Number.isSafeInteger(second.rank) || first.rank < 1 || second.rank < 1 || !["SINGLE", "HOME_AND_AWAY"].includes(format))
    return { ok: false as const, code: "INVALID_PLAYOFF_TEAMS" as const };
  if (first.rank === second.rank) return { ok: false as const, code: "HOME_TEAM_UNDECIDED" as const };
  const better = first.rank < second.rank ? first.teamId : second.teamId;
  const other = better === first.teamId ? second.teamId : first.teamId;
  return { ok: true as const, matches: format === "SINGLE" ? [{ home: better, away: other }] : [{ home: other, away: better }, { home: better, away: other }] };
}

export type PlayoffOfficialLeg = { home: string; away: string; homeScore: number | null; awayScore: number | null; matchStatus: string; resultSource: string | null; reportStatus: string | null; reportConfirmed: boolean; offendingTeamId?: string | null };
/** Never infer penalties, administrative decisions, or a winner from an unfinished leg. */
export function resolvePlayoffWinner(first: {teamId:string;rank:number}, second: {teamId:string;rank:number}, round: "QUARTERFINAL" | "SEMIFINAL" | "FINAL", format: "SINGLE" | "HOME_AND_AWAY", criterion: "STANDING_POSITION" | "PENALTIES", legs: PlayoffOfficialLeg[]) {
  const required=format === "SINGLE" ? 1 : 2;
  if(legs.length!==required) return {ok:false as const,code:"LEGS_INCOMPLETE" as const};
  if(first.teamId===second.teamId || legs.some(leg => ![first.teamId,second.teamId].includes(leg.home) || ![first.teamId,second.teamId].includes(leg.away) || leg.home===leg.away) || (required===2 && legs[0].home===legs[1].home)) return {ok:false as const,code:"INVALID_LEGS" as const};
  if(legs.some(leg => leg.matchStatus!=="FINISHED" || !["MATCH_REPORT","DEFAULT"].includes(leg.resultSource??"") || leg.reportStatus!=="CONFIRMED" || !leg.reportConfirmed || !Number.isSafeInteger(leg.homeScore) || !Number.isSafeInteger(leg.awayScore) || leg.homeScore!<0 || leg.awayScore!<0 || (leg.resultSource==="DEFAULT" && !((leg.offendingTeamId===leg.home && leg.homeScore===0 && leg.awayScore===1) || (leg.offendingTeamId===leg.away && leg.homeScore===1 && leg.awayScore===0))))) return {ok:false as const,code:"OFFICIAL_RESULTS_INCOMPLETE" as const};
  let a=0,b=0;
  for(const leg of legs) { a+=leg.home===first.teamId ? leg.homeScore! : leg.awayScore!; b+=leg.home===second.teamId ? leg.homeScore! : leg.awayScore!; }
  if(a!==b) return {ok:true as const,winnerId:a>b?first.teamId:second.teamId};
  const resolved=tiedPlayoffResolution(round,criterion,first.rank,second.rank);
  if(resolved.kind!=="ADVANCES") return {ok:false as const,code:resolved.kind === "PENALTIES" ? "PENALTIES_REQUIRED" as const : "POSITION_UNRESOLVED" as const};
  return {ok:true as const,winnerId:resolved.side==="FIRST"?first.teamId:second.teamId};
}

type DateWindow = { start: string; end: string };
/** Date-only windows are inclusive local calendar dates, not UTC timestamps. */
export function validatePlayoffCalendar(input: {
  season: DateWindow; regularDeadline: string; regularDays: DateWindow[];
  playoffDays: DateWindow[]; format: PlayoffFormat;
}) {
  const { season, regularDeadline, regularDays, playoffDays, format } = input;
  const dates = [season.start, season.end, regularDeadline, ...regularDays.flatMap(day => [day.start, day.end]), ...playoffDays.flatMap(day => [day.start, day.end])];
  if (dates.some(date => !z.iso.date().safeParse(date).success) || season.start > season.end || regularDeadline < season.start || regularDeadline >= season.end)
    return { ok: false as const, code: "INVALID_SEASON_DATES" as const };
  if (regularDays.length === 0) return { ok: false as const, code: "REGULAR_DATES_REQUIRED" as const };
  if (playoffDays.length !== playoffDatesRequired(format)) return { ok: false as const, code: "PLAYOFF_DATE_COUNT" as const, required: playoffDatesRequired(format) };
  const check = (days: DateWindow[], lower: string, upper: string) => days.every((day, i) =>
    day.start <= day.end && day.start >= lower && day.end <= upper && (i === 0 || day.start > days[i - 1].end));
  if (!check(regularDays, season.start, regularDeadline)) return { ok: false as const, code: "REGULAR_DATES_OUTSIDE_WINDOW" as const };
  if (!check(playoffDays, season.start, season.end) || playoffDays[0].start <= regularDeadline)
    return { ok: false as const, code: "PLAYOFF_DATES_OUTSIDE_WINDOW" as const };
  return { ok: true as const, required: playoffDays.length };
}

/** Eight places distributed equally; incomplete standings must never qualify a team. */
export type PlayoffGroup = { id: string; teams: { teamId: string; rank: number | null; unresolved: string | null }[] };

export function qualifyForPlayoffs(groups: PlayoffGroup[]) {
  if (![1, 2, 4, 8].includes(groups.length)) return { ok: false as const, code: "UNSUPPORTED_GROUP_COUNT" as const };
  if (new Set(groups.map(group => group.id)).size !== groups.length || new Set(groups.flatMap(group => group.teams.map(team => team.teamId))).size !== groups.reduce((n, group) => n + group.teams.length, 0))
    return { ok: false as const, code: "DUPLICATE_GROUP_OR_TEAM" as const };
  const places = 8 / groups.length;
  if (groups.some(group => group.teams.length < places)) return { ok: false as const, code: "INSUFFICIENT_TEAMS" as const };
  const qualified: { groupId: string; teamId: string; rank: number }[] = [];
  for (const group of groups) {
    // A tie at the cutoff cannot be resolved by team ID or input order.
    if (group.teams.some(team => team.rank === null || team.unresolved !== null)) return { ok: false as const, code: "UNRESOLVED_STANDINGS" as const };
    const ranks = group.teams.map(team => team.rank as number);
    if (new Set(ranks).size !== ranks.length || ranks.some(rank => !Number.isInteger(rank) || rank < 1 || rank > ranks.length))
      return { ok: false as const, code: "INVALID_RANKS" as const };
    qualified.push(...group.teams.filter(team => team.rank! <= places).map(team => ({ groupId: group.id, teamId: team.teamId, rank: team.rank! })));
  }
  return { ok: true as const, placesPerGroup: places, qualified };
}
