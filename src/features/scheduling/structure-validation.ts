export type SchedulePairing = { round:number; matchdayId:string; home:string; away:string };
type ScheduleDay = { id:string; number:number };

/** Comprueba jornadas, participantes y alternancia de localía en cada vuelta. */
export function validateScheduleStructure(teams:string[], days:ScheduleDay[], legs:number, matches:SchedulePairing[]) {
  const roundsPerLeg=teams.length%2?teams.length:teams.length-1;
  const perRound=Math.floor(teams.length/2);
  const expected=roundsPerLeg*legs;
  if(days.length!==expected || matches.length!==expected*perRound) return {ok:false as const,code:"INVALID_MATCH_COUNT"};
  const known=new Set(teams), byes:{round:number;teamId:string;matchdayId:string}[]=[];
  const legsPairs=Array.from({length:legs},()=>new Map<string,string>());
  for(let i=0;i<days.length;i++) {
    const day=days[i], current=matches.filter(match=>match.round===day.number);
    if(current.length!==perRound || current.some(match=>match.matchdayId!==day.id)) return {ok:false as const,code:"INVALID_MATCHDAY",round:day.number};
    const used=new Set<string>();
    for(const match of current) {
      if(!known.has(match.home)||!known.has(match.away)||match.home===match.away||used.has(match.home)||used.has(match.away))
        return {ok:false as const,code:"INVALID_TEAMS_IN_ROUND",round:day.number};
      used.add(match.home); used.add(match.away);
      const key=[match.home,match.away].sort().join("/"), pair=legsPairs[Math.floor(i/roundsPerLeg)];
      if(pair.has(key)) return {ok:false as const,code:"DUPLICATE_PAIRING",round:day.number};
      pair.set(key,match.home);
    }
    for(const team of teams) if(!used.has(team)) byes.push({round:day.number,teamId:team,matchdayId:day.id});
  }
  if(matches.some(match=>!days.some(day=>day.number===match.round))) return {ok:false as const,code:"INVALID_MATCHDAY"};
  for(let leg=1;leg<legs;leg++) for(const [pair,home] of legsPairs[leg])
    if(legsPairs[leg-1].get(pair)===home) return {ok:false as const,code:"HOME_AWAY_NOT_REVERSED"};
  return {ok:true as const,byes};
}
