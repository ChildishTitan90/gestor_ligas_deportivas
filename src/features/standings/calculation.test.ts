import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateStandings, type ResultInput } from './calculation';
const rule = { points: { win: 5, draw: 2, loss: -1 }, tieBreakers: ['GOAL_DIFFERENCE', 'GOALS_FOR'] };
const result = (patch: Partial<ResultInput> = {}): ResultInput => ({ id:'r',matchId:'m',version:1,home:'a',away:'b',homeScore:2,awayScore:1,source:'MATCH_REPORT',status:'FINISHED',counts:true,offender:null,reportStatus:'CONFIRMED',...patch });
test('victoria, empate, derrota, DG y puntuación versionada',()=>{
 const rows = calculateStandings(['a','b'],[result(),result({matchId:'m2',homeScore:1,awayScore:1})],rule);
 assert.deepEqual(rows.map(r=>[r.teamId,r.played,r.won,r.drawn,r.lost,r.scoreFor,r.scoreAgainst,r.difference,r.points,r.rank]),[['a',2,1,1,0,3,2,1,7,1],['b',2,0,1,1,2,3,-1,1,2]]);
});
for(const offender of ['a','b'])test(`default infractor ${offender}, sin goleador`,()=>{
 const rows=calculateStandings(['a','b'],[result({source:'DEFAULT',status:'NO_SHOW',offender,homeScore:offender==='a'?0:1,awayScore:offender==='a'?1:0})],rule);
 assert.equal(rows[0].points,3);assert.equal(rows[0].scoreFor,1);assert.equal(rows[1].points,0);assert.equal(rows[1].scoreAgainst,1);
});
test('no cuenta borrador, suspendido, cancelado, en revisión, ni exclusión explícita',()=>{
 for(const patch of [{counts:false},{status:'UNDER_REVIEW'},{status:'CANCELED'},{status:'SUSPENDED'},{reportStatus:'DRAFT'},{source:'ADMINISTRATIVE',status:'FINISHED'}]) assert.ok(calculateStandings(['a','b'],[result(patch)],rule).every(r=>r.played===0));
});
test('criterio desconocido no se salta; no inventa gol average ni empate definitivo',()=>{
 const rows=calculateStandings(['a','b'],[result({homeScore:1,awayScore:1})],{...rule,tieBreakers:['GOL_AVERAGE','GOALS_FOR']});
 assert.ok(rows.every(r=>r.rank===null&&r.unresolved==='UNSUPPORTED_TIE_BREAKER:GOL_AVERAGE'));
 assert.ok(calculateStandings(['a','b'],[],rule).every(r=>r.rank===null));
});
test('no inventa resultado default y rechaza duplicados/ámbito ajeno',()=>{
 assert.throws(()=>calculateStandings(['a','b'],[result({source:'DEFAULT',status:'NO_SHOW',offender:'a'})],rule),/INVALID_DEFAULT_SCORE/);
 assert.throws(()=>calculateStandings(['a','b'],[result(),result()],rule),/DUPLICATE/);
 assert.throws(()=>calculateStandings(['a'],[result()],rule),/OUTSIDE_GROUP/);
 assert.deepEqual(calculateStandings(['a','b'],[result()],rule),calculateStandings(['a','b'],[result()],rule));
});

test('goleador, autogol y doble amarilla conservan eventos y no atribuyen faltantes',async()=>{
 const { eventStatistics }=await import('./event-statistics');
 const base={matchId:'m',reportId:'r',reportVersion:2,teamId:'a',playerId:'p'};
 const events=['GOAL','OWN_GOAL','CAUTION','CAUTION'].map((code,n)=>({...base,id:String(n),code}));
 const stats=eventStatistics([...events,{...base,id:'missing',code:'GOAL',playerId:null}]);
 assert.deepEqual([stats.players[0].goals,stats.players[0].ownGoals,stats.players[0].cautions,stats.players[0].secondCautionDismissals],[1,1,2,1]);
 assert.deepEqual(stats.unattributedEventIds,['missing']);assert.equal(stats.completeness,'UNKNOWN');
});

test('resolución administrativa elegible y orden explícito de criterios',()=>{
 const admin=result({source:'ADMINISTRATIVE',status:'ADMINISTRATIVELY_RESOLVED',reportStatus:null});
 assert.equal(calculateStandings(['a','b'],[admin],rule)[0].points,5);
 const fixtures=[result({home:'a',away:'c',homeScore:1,awayScore:0}),result({matchId:'m2',home:'b',away:'d',homeScore:3,awayScore:2})];
 const byGoals=calculateStandings(['a','b','c','d'],fixtures,{...rule,tieBreakers:['GOALS_FOR','GOAL_DIFFERENCE']});
 assert.equal(byGoals[0].teamId,'b');assert.equal(byGoals[0].rank,1);
});
