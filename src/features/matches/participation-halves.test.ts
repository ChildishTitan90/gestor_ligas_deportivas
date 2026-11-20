import assert from "node:assert/strict";
import test from "node:test";
import { halfCrossingProblem, type HalfContext } from "./participation-halves";
import { advanceMatchClock, verifiedClockBoundaries } from "@/features/match-reports/match-clock";
import { halfReservationData, updateDraftLineup } from "@/features/match-reports/lineup-draft";
import { createReportDemo } from "@/features/match-reports/demo-data";
import { participationPeriods } from "@/features/match-reports/tactics";
const first: HalfContext = {seasonId:"s",clubId:"c",categoryId:"a",half:1,startsAt:new Date("2026-11-18T18:00Z"),endsAt:new Date("2026-11-18T20:00Z"),hasParticipation:false};
const second: HalfContext = {...first,categoryId:"b",half:2};
test("hora declarada y reloj legado conservan su captura sin acreditar un traslado",()=>{
 const start="2026-11-18T18:00:00Z", end="2026-11-18T18:43:00Z";
 const declared=advanceMatchClock(null,{type:"start",halfMinutes:40,breakMinutes:10},start);
 const clock=advanceMatchClock(declared,{type:"end-half"},end,"server");
 assert.deepEqual(clock.boundaries,{firstStartedAt:start,firstEndedAt:end});
 assert.deepEqual(verifiedClockBoundaries(clock),{firstEndedAt:end});
 assert.deepEqual(verifiedClockBoundaries({...clock,boundarySources:undefined}),{});
 const adjusted=advanceMatchClock(clock,{type:"set-break",minutes:15},end,"server");
 assert.equal(adjusted.boundarySources?.firstStartedAt,"device");
});
test("RF02.7: reserva complementaria, sin doble registro ni duración supuesta",()=>{
 assert.equal(halfCrossingProblem(first,second),null);
 assert.equal(halfCrossingProblem({...first,half:undefined},second),"PARTICIPATION_HALF_REQUIRED");
 assert.equal(halfCrossingProblem(first,{...second,half:1}),"PARTICIPATION_HALF_CONFLICT");
 for(const context of [{clubId:"otro"},{seasonId:"otra"},{categoryId:"a"}])assert.equal(halfCrossingProblem(first,{...second,...context}),"PARTICIPATION_CONTEXT_CONFLICT");
});
test("RF02.7: descanso real, retraso, compensación y fronteras contiguas",()=>{
 const a={...first,hasParticipation:true,boundaries:{firstStartedAt:"2026-11-18T18:00:00Z",firstEndedAt:"2026-11-18T18:48:00Z"}};
 const b={...second,hasParticipation:true,boundaries:{secondStartedAt:"2026-11-18T19:03:00Z"}};
 assert.equal(halfCrossingProblem(a,b),null);
 assert.equal(halfCrossingProblem(a,{...b,boundaries:{secondStartedAt:a.boundaries.firstEndedAt}}),null);
 assert.equal(halfCrossingProblem(a,{...b,boundaries:{secondStartedAt:"2026-11-18T18:47:59Z"}}),"PARTICIPATION_REAL_TIME_CONFLICT");
 assert.equal(halfCrossingProblem({...a,boundaries:{}},b),"PARTICIPATION_CLOCK_REQUIRED");
 assert.equal(halfCrossingProblem(a,{...b,boundaries:{}}),"PARTICIPATION_CLOCK_REQUIRED");
 assert.equal(halfCrossingProblem({...a,endsAt:new Date('2026-11-18T18:30Z')},{...b,startsAt:new Date('2026-11-18T18:35Z'),boundaries:{secondStartedAt:'2026-11-18T18:40:00Z'}}),"PARTICIPATION_REAL_TIME_CONFLICT");
});
test("el reloj conserva ambas mitades; no reconstruye marcas históricas ausentes",()=>{
 let clock=advanceMatchClock(null,{type:'start',halfMinutes:40,breakMinutes:10},'2026-11-18T18:00:00Z');
 clock=advanceMatchClock(clock,{type:'end-half'},'2026-11-18T18:43:00Z');
 clock=advanceMatchClock(clock,{type:'start-second'},'2026-11-18T18:55:00Z');
 clock=advanceMatchClock(clock,{type:'end-half'},'2026-11-18T19:38:00Z');
 assert.deepEqual(clock.boundaries,{firstStartedAt:'2026-11-18T18:00:00Z',firstEndedAt:'2026-11-18T18:43:00Z',secondStartedAt:'2026-11-18T18:55:00Z',secondEndedAt:'2026-11-18T19:38:00Z'});
 const {boundaries:discarded,...legacy}=clock;void discarded;
 assert.equal(advanceMatchClock({...legacy,phase:'BREAK'},{type:'start-second'},'2026-11-18T19:50:00Z').boundaries?.firstEndedAt,undefined);
 const row={playerId:'p',selected:true,starter:true,matchJersey:1,participationHalf:1 as const,periods:[]};
 assert.deepEqual(participationPeriods(row,[],clock),[{periodNumber:1,entryMinute:0,exitMinute:43}]);
});
test("reserva provisional no elude sanción ni ubica al segundo tiempo como titular",()=>{
 const data=createReportDemo('empty'),p=data.players[0];p.eligible=false;p.halfRestriction=2;p.blockers=[{code:'PARTICIPATION_HALF_REQUIRED',message:'Mitad requerida'}];
 data.report.lineups.find(r=>r.playerId===p.id)!.participationHalf=2;
 const reserved=halfReservationData(data,data.report);assert.equal(reserved.players[0].eligible,true);
 const next=updateDraftLineup(reserved,data.report,p.id,{selected:true});assert.equal(next.lineups.find(r=>r.playerId===p.id)!.starter,false);
 p.blockers.push({code:'PARTICIPATION_BLOCKED',message:'Sanción'});assert.equal(halfReservationData(data,data.report).players[0].eligible,false);
});

test("horarios separados no sustituyen marcas reales de una participación registrada",()=>{
 const a={...first,startsAt:new Date("2026-11-18T10:00Z"),endsAt:new Date("2026-11-18T12:00Z"),hasParticipation:true,boundaries:{firstStartedAt:"2026-11-18T10:00:00Z",firstEndedAt:"2026-11-18T12:15:00Z"}};
 const b={...second,startsAt:new Date("2026-11-18T12:00Z"),endsAt:new Date("2026-11-18T14:00Z"),hasParticipation:true,boundaries:{secondStartedAt:"2026-11-18T12:10:00Z"}};
 for(const [left,right] of [[{...a,boundaries:{}},b],[{...a,boundaries:{firstStartedAt:a.boundaries.firstStartedAt}},b],[a,{...b,boundaries:{}}]] as const){
   assert.equal(halfCrossingProblem(left,right),"PARTICIPATION_CLOCK_REQUIRED");
   assert.equal(halfCrossingProblem(right,left),"PARTICIPATION_CLOCK_REQUIRED");
 }
 assert.equal(halfCrossingProblem(a,b),"PARTICIPATION_REAL_TIME_CONFLICT");
 assert.equal(halfCrossingProblem({...a,boundaries:{...a.boundaries,firstEndedAt:b.boundaries.secondStartedAt}},b),null);
 assert.equal(halfCrossingProblem({...a,hasParticipation:false,boundaries:{}},{...b,hasParticipation:false,boundaries:{}}),null,"Reservar sin juego registrado no acredita un traslado");
});

test("iniciar el partido actual no exige terminarlo por una reserva posterior sin juego",()=>{
 const today={...first,hasParticipation:true,boundaries:{firstStartedAt:"2026-11-18T18:00:00Z"}};
 const tomorrow={...second,startsAt:new Date("2026-11-19T18:00Z"),endsAt:new Date("2026-11-19T20:00Z"),hasParticipation:false};
 assert.equal(halfCrossingProblem(today,tomorrow),null);
 assert.equal(halfCrossingProblem(tomorrow,today),"PARTICIPATION_CLOCK_REQUIRED","Evaluar el destino no ignora el antecedente en juego");
 assert.equal(halfCrossingProblem(today,{...tomorrow,hasParticipation:true}),"PARTICIPATION_CLOCK_REQUIRED","Una participación registrada sin reloj no es reserva");
 assert.equal(halfCrossingProblem({...today,boundaries:{}},tomorrow),"PARTICIPATION_CLOCK_REQUIRED","Sin inicio real no se presupone la secuencia");
});
