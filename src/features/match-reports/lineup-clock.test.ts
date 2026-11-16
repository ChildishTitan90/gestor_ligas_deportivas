import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { advanceMatchClock, breakEventError, clockReading } from "./match-clock";
import { formationLines, formationSlots, keeperKit } from "./tactics";
import { jerseyErrors, lineupSnapshot } from "./lineup-rules";
import { createReportDemo } from "./demo-data";
import type { ReportDraft } from "./contract";

test("dorsales se validan por equipo, también para banca; no se confunden con el habitual", () => {
  const data = createReportDemo("setup");
  data.report.lineups.find(r => r.playerId === "home-12")!.matchJersey = 17;
  assert.match(jerseyErrors(data, data.report)["home-12"], /dorsal 17/);
  assert.match(jerseyErrors(data, data.report)["home-7"], /dorsal 17/);
  data.report.lineups.find(r => r.playerId === "home-12")!.matchJersey = 12;
  assert.deepEqual(jerseyErrors(data, data.report), {});
});
test("el sello ignora periodos y orden pero detecta dorsal, capitán, posición o uniforme", () => {
  const a = randomUUID(), team = randomUUID();
  const draft: ReportDraft = { lineups: [{ playerId:a, teamId:team,selected:true,starter:true,matchJersey:7,periods:[] }],captains:{[team]:a},events:[],score:{home:null,away:null},remarks:"",incidents:"",signatures:{} };
  const changed = structuredClone(draft);changed.lineups[0].periods.push({periodNumber:1,entryMinute:0,exitMinute:45});
  assert.deepEqual(lineupSnapshot(draft),lineupSnapshot(changed));
  changed.lineups[0].matchJersey=8;assert.notDeepEqual(lineupSnapshot(draft),lineupSnapshot(changed));
});
test("formación escrita suma diez más portero y color del portero se diferencia", () => {
  assert.deepEqual(formationLines("4-2-2-2"),[4,2,2,2]);
  assert.equal(formationSlots("4-2-2-2").length,11);
  assert.equal(formationLines("4-4-3"),null);
  assert.equal(formationLines("4--4-2"),null);
  const yellow = keeperKit({kit:null}).primary;
  assert.notDeepEqual(keeperKit({kit:{primary:yellow,secondary:yellow}}).primary,yellow);
});
test("45 minutos, compensación sin reiniciar, descanso ajustable y segundo tiempo", () => {
  let clock = advanceMatchClock(null,{type:"start",halfMinutes:45,breakMinutes:15},"2026-11-15T18:00:00Z");
  assert.equal(clockReading(clock,Date.parse("2026-11-15T18:45:00Z")).baseReached,true);
  clock=advanceMatchClock(clock,{type:"add-time",minutes:3},"2026-11-15T18:45:10Z");
  assert.equal(clock.phaseStartedAt,"2026-11-15T18:00:00Z");
  assert.equal(clockReading(clock,Date.parse("2026-11-15T18:47:59Z")).timeReached,false);
  assert.equal(clockReading(clock,Date.parse("2026-11-15T18:48:00Z")).timeReached,true);
  clock=advanceMatchClock(clock,{type:"end-half"},"2026-11-15T18:48:00Z");
  clock=advanceMatchClock(clock,{type:"set-break",minutes:20},"2026-11-15T18:50:00Z");
  assert.equal(clockReading(clock,Date.parse("2026-11-15T19:00:00Z")).remaining,8*60);
  clock=advanceMatchClock(clock,{type:"start-second"},"2026-11-15T19:08:00Z");
  assert.equal(clockReading(clock,Date.parse("2026-11-15T19:13:00Z")).minute,50);
  assert.equal(clockReading(clock,Date.parse("2026-11-15T19:13:00Z")).periodMinute,5);
  assert.equal(clockReading(clock,Date.parse("2026-11-15T19:13:00Z")).periodNumber,2);
  clock=advanceMatchClock(clock,{type:"end-half"},"2026-11-15T19:53:00Z");
  assert.equal(clockReading(clock,Date.parse("2026-11-16T19:53:00Z")).elapsed,45*60);
  assert.throws(()=>advanceMatchClock(clock,{type:"start-second"},"2026-11-15T20:00:00Z"),/CLOCK_PHASE_CONFLICT/);
});

test("descanso: solo cambios en P2 45:00, participación desde 0 y antecedentes intactos", async () => {
  const { participationPeriods, orderedEvents } = await import("./tactics");
  const clock = advanceMatchClock(advanceMatchClock(null,{type:"start",halfMinutes:45,breakMinutes:15},"2026-11-15T18:00:00Z"),{type:"end-half"},"2026-11-15T18:48:00Z");
  const timing=clockReading(clock,Date.parse("2026-11-15T19:00:34Z"));
  assert.deepEqual([timing.minute,timing.second,timing.periodNumber,timing.periodMinute],[45,0,2,0]);
  const change={id:randomUUID(),typeCode:"SUBSTITUTION",teamId:randomUUID(),playerId:randomUUID(),outgoingPlayerId:randomUUID(),minute:45,second:0,periodMinute:0,periodNumber:2,description:"Cambio de descanso"};
  const old={...change,id:randomUUID(),typeCode:"GOAL",minute:12,periodNumber:1,periodMinute:12};
  assert.equal(breakEventError(clock,[old],[{...old},change]),null);
  assert.equal(breakEventError(clock,[old],[old,{...change,typeCode:"GOAL"}]),"BREAK_SUBSTITUTIONS_ONLY");
  assert.equal(breakEventError(clock,[],[{...change,minute:46}]),"BREAK_SUBSTITUTION_TIME");
  assert.equal(breakEventError(clock,[],[{...change,second:30}]),"BREAK_SUBSTITUTION_TIME");
  assert.equal(breakEventError(clock,[],[{...change,periodNumber:1}]),"BREAK_SUBSTITUTION_TIME");
  assert.equal(participationPeriods({playerId:change.playerId!,selected:true,starter:false,matchJersey:9,periods:[]},[change])[0].entryMinute,0);
  const second=advanceMatchClock(clock,{type:"start-second"},"2026-11-15T19:03:00Z");
  assert.equal(clockReading(second,Date.parse("2026-11-15T19:03:00Z")).minute,45);
  const oldSecond={...old,periodNumber:2,minute:6,periodMinute:undefined};
  const newSecond={...change,minute:50,periodMinute:5};
  assert.equal(orderedEvents([oldSecond,newSecond])[0].id,newSecond.id);
  assert.equal(breakEventError(second,[],[{...change,typeCode:"GOAL"}]),null);
  const short={...clock,halfMinutes:40};
  assert.equal(clockReading(short,Date.parse("2026-11-15T19:00:00Z")).minute,40);
});


test("segunda amarilla expulsa sin sustitución, cierra participación y exige relevo de capitán", async () => {
  const {dismissalEvents,currentPitch,participationPeriods}=await import("./tactics");
  const {effectiveCaptain,invalidCaptainTransitions}=await import("./captaincy");
  const a=randomUUID(),b=randomUUID(),c=randomUUID(),team=randomUUID();
  const slots=formationSlots("4-4-2").map((s,i)=>({...s,playerId:i===0?a:i===1?b:null}));
  const yellow=(minute:number)=>({id:randomUUID(),typeCode:"CAUTION",teamId:team,playerId:a,outgoingPlayerId:null,periodNumber:1,minute,description:""});
  const first=yellow(9),second={...yellow(20),replacementCaptainId:b};
  assert.equal(currentPitch(slots,[first],team).slots[0].playerId,a);
  assert.equal(currentPitch(slots,[first,second],team).slots[0].playerId,null);
  assert.equal(dismissalEvents([first,second]).length,1);
  assert.equal(effectiveCaptain(a,[first,second],team),b);
  assert.equal(invalidCaptainTransitions(a,slots,[first,second],team),false);
  assert.equal(invalidCaptainTransitions(a,slots,[first,yellow(20)],team),true);
  assert.equal(participationPeriods({playerId:a,selected:true,starter:true,matchJersey:1,periods:[{periodNumber:1,entryMinute:0,exitMinute:null}]},[first,second])[0].exitMinute,20);
  const substitute={id:randomUUID(),typeCode:"SUBSTITUTION",teamId:team,playerId:c,outgoingPlayerId:a,periodNumber:1,minute:21,description:""};
  assert.equal(currentPitch(slots,[first,second,substitute],team).problems.length,1);
  const change={...substitute,minute:5,replacementCaptainId:c};
  assert.equal(effectiveCaptain(a,[change],team),c);
  assert.equal(invalidCaptainTransitions(a,slots,[change],team),false);
});


test("segundos del reloj y eventos conservan precisión sin completar historia desconocida", async () => {
 const {eventTimeLabel,orderedEvents}=await import("./tactics");
 const clock=advanceMatchClock(null,{type:"start",halfMinutes:45,breakMinutes:15},"2026-11-15T18:00:00Z");
 assert.equal(clockReading(clock,Date.parse("2026-11-15T18:22:34Z")).second,34);
 assert.equal(eventTimeLabel({minute:22,second:34}),"22:34");
 assert.match(eventTimeLabel({minute:22}),/segundos sin indicar/);
 const base={id:randomUUID(),typeCode:"GOAL",playerId:randomUUID(),teamId:randomUUID(),outgoingPlayerId:null,periodNumber:1,minute:22,description:""};
 const later={...base,second:40},earlier={...base,id:randomUUID(),second:10};
 assert.equal(orderedEvents([later,earlier])[0].id,earlier.id);
});
