import test from "node:test";
import assert from "node:assert/strict";
import { roundRobin } from "./generator";
import { proposeTeamSwap } from "./team-swap";
import { validateScheduleStructure } from "./structure-validation";

test("intercambiar equipos en una jornada ajusta las demás sin repetir cruces", () => {
  for (const size of [5,6]) for (const legs of [1,2]) {
    const teams=Array.from({length:size},(_,i)=>String(i));
    const calendar=roundRobin(teams,legs);
    const matches=calendar.pairings.map(match=>({...match,matchdayId:String(match.round)}));
    const firstRound=matches.filter(match=>match.round===1);
    const swapped=proposeTeamSwap(matches,1,firstRound[0].home,firstRound[1].home);
    const days=[...new Set(matches.map(match=>match.round))].map(number=>({id:String(number),number}));
    assert.equal(validateScheduleStructure(teams,days,legs,swapped.map(item=>({...item.before,home:item.home,away:item.away}))).ok,true);
    assert.equal(swapped[0].home,firstRound[1].home);
    assert.equal(swapped[1].home,firstRound[0].home);
    assert.ok(swapped.some(item=>item.before.round>1 && item.changed));
  }
});

test("no permite intercambiar un equipo consigo mismo o con su rival", () => {
  const matches=[{round:1,matchdayId:"1",home:"A",away:"B"}];
  assert.throws(()=>proposeTeamSwap(matches,1,"A","A"));
  assert.throws(()=>proposeTeamSwap(matches,1,"A","B"));
});
