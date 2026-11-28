import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../../src/server/db/prisma';
import { calculateForActor, calculateStandingsInTransaction, readStandingsForActor } from '../../src/features/standings/server/service';
import { previewPlayoffQualifiersForActor } from '../../src/features/competitions/server/playoff-qualifiers';
import { confirmPlayoffBracketForActor, readConfirmedPlayoffBracketForActor, validatePlayoffStandingsForActor } from '../../src/features/competitions/server/playoff-bracket';
import { createPlayoffQuarterfinalsForActor } from '../../src/features/competitions/server/playoff-matches';
import { getRescheduleSlotsInTransaction } from '../../src/features/matches/server/reschedule-slots';
import { rescheduleAbsentMatchInTransaction } from '../../src/features/matches/server/reschedule';
import { advancePlayoffResultInTransaction } from '../../src/features/competitions/server/playoff-advance';
import { confirmPlayoffPenaltiesForActor } from '../../src/features/competitions/server/playoff-penalties';
import { assertPlayoffsComplete, closeSeasonForActor } from '../../src/features/competitions/server/close-season';
import { roundRobin } from '../../src/features/scheduling/generator';
import { spawnSync } from 'node:child_process';
import { PREVIEW_MARKER, provisionPreviewRuntime } from '../../scripts/preview/runtime-plan.mjs';

test('clasificación transaccional sobre PostgreSQL desechable', async t => {
 assert.equal(process.env.STANDINGS_ISOLATED,'1','Usar exclusivamente el runner desechable');
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const q=async(sql:string,args:unknown[]=[]) => (await db.query(sql,args)).rows;
 const id=async(sql:string,args:unknown[]=[]) => (await q(sql,args))[0].id as string;
 try {
 await q('BEGIN');
 const person=await id("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Sintética','Clasificación') RETURNING id");
 const actor=await id("INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password) VALUES($1,'standing-synthetic','standing@example.invalid','!disabled',false) RETURNING id",[person]);
 await q("SELECT set_config('app.user_id',$1,true),set_config('app.reason','PDGLD-29: fixtures sintéticos',true)",[actor]);
 const league=await id("INSERT INTO sports_management.leagues(name) VALUES('Liga sintética clasificación') RETURNING id");
 const sport=await id("INSERT INTO sports_management.sports(code,name) VALUES('SYNTHETIC29','Sintético') RETURNING id");
 const season=await id("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,'Temporada sintética','2026-01-01','2026-12-31') RETURNING id",[league,sport]);
 const role=await id("INSERT INTO sports_management.roles(code,name) VALUES('STANDING_TEST','Prueba sintética') RETURNING id");
 for(const action of ['READ','UPDATE']){
 const perm=await id('INSERT INTO sports_management.permissions(module,action) VALUES(\'competitions\',$1) RETURNING id',[action]);
 await q('INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES($1,$2,false)',[role,perm]);
 }
 await q('INSERT INTO sports_management.user_roles(user_id,role_id,league_id) VALUES($1,$2,$3)',[actor,role,league]);
 const rule=await id('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id',[season]);
 for(const [key,value] of Object.entries({points:{win:5,draw:2,loss:0},tieBreakers:['GOAL_DIFFERENCE','GOALS_FOR']}))await q('INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by) VALUES($1,$2,$3,$4)',[rule,key,JSON.stringify(value),actor]);
 await q("UPDATE sports_management.competition_rules SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1",[rule,actor]);
 const category=await id("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Categoría sintética') RETURNING id",[league,sport]);
 const sc=await id("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date) VALUES($1,$2,$3,1,'OPEN','2026-01-01') RETURNING id",[season,category,rule]);
 const group=await id("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,'Grupo sintético') RETURNING id",[season,sc]);
 const teams:string[]=[];
 for(let n=0;n<3;n++){
 const club=await id("INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES($1,$2,$2) RETURNING id",[league,`club29-${n}`]);
 await q("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,requested_by) VALUES($1,$2,$3,$4,'Azul',$5)",[season,club,league,`aff29-${n}`,actor]);
 const team=await id('INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES($1,$2,$2) RETURNING id',[club,`team29-${n}`]);
 teams.push(await id('INSERT INTO sports_management.season_teams(season_id,team_id,club_id,group_id,season_category_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[season,team,club,group,sc]));
 }
 const days:string[]=[];for(let n=1;n<=4;n++)days.push(await id("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,$2,'2026-02-01','2026-02-02') RETURNING id",[season,n]));
 async function match(day:number,home:number,away:number,source:string,hs:number,as:number,offender:number|null,status:string){
 const m=await id('INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,status_id) VALUES($1,$2,$3,$4,$5,$6,sports_management.get_match_status_id($7)) RETURNING id',[season,group,days[day],randomUUID(),teams[home],teams[away],status]);
 await q('INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,offending_team_id,validated_by) VALUES($1,$2,$3,$4,$5,$6)',[m,hs,as,source,offender===null?null:teams[offender],actor]);return m;
 }
 const first=await match(1,0,1,'DEFAULT',1,0,1,'NO_SHOW');
 const defaultReport=await id("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now()) RETURNING id",[first,randomUUID(),actor]);
 await q("INSERT INTO sports_management.match_events(match_report_id,event_type_id,season_team_id) VALUES($1,(SELECT id FROM sports_management.event_types WHERE code='CAUTION'),$2)",[defaultReport,teams[0]]);
 const resolvedDefault=await match(2,0,2,'DEFAULT',0,1,0,'FINISHED');
 const reported=await match(3,1,2,'MATCH_REPORT',3,2,null,'FINISHED');
 const report=await id("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'MOBILE','CONFIRMED',now()) RETURNING id",[reported,randomUUID(),actor]);
 for(const code of ['GOAL','CAUTION','CAUTION'])await q("INSERT INTO sports_management.match_events(match_report_id,event_type_id,season_team_id) VALUES($1,(SELECT id FROM sports_management.event_types WHERE code=$2),$3)",[report,code,teams[1]]);
 await q('COMMIT');
 await q("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-29: prueba sintética',false)",[actor]);
 const input={groupId:group,matchdayId:days[2]};
 await t.test('consulta de clasificados exige permiso y reglamento de liguilla',async()=>{
   await assert.rejects(previewPlayoffQualifiersForActor(randomUUID(),season,sc));
   await assert.rejects(previewPlayoffQualifiersForActor(actor,season,sc),/PLAYOFF_RULE_REQUIRED/);
 });
 let receipt: Awaited<ReturnType<typeof calculateForActor>>;
 await t.test('corte acumulado, default en ambas localías, DG generado y procedencia',async()=>{
 receipt=await calculateForActor(actor,input);
 const a=receipt.data.rows.find(r=>r.teamId===teams[0])!;assert.deepEqual([a.played,a.won,a.lost,a.scoreFor,a.scoreAgainst,a.points],[2,1,1,1,1,3]);
 assert.equal(receipt.data.results.length,2);
 assert.equal(receipt.data.results.filter(r=>r.matchId===resolvedDefault&&r.source==='DEFAULT'&&r.status==='FINISHED').length,1);
 const visitor=receipt.data.rows.find(r=>r.teamId===teams[2])!;assert.deepEqual([visitor.played,visitor.won,visitor.scoreFor,visitor.points],[1,1,1,3]);assert.equal(receipt.data.events.length,1);assert.equal(receipt.data.events[0].resultSource,'DEFAULT');assert.equal(receipt.data.events[0].reportSource,'PAPER');assert.ok(receipt.data.statistics.every(s=>s.officialGoals===null));
 const stored=await q('SELECT score_difference,score_for-score_against AS dg FROM sports_management.standing_entries WHERE standing_version_id=$1',[receipt.id]);assert.ok(stored.every(r=>r.score_difference===r.dg));
 });
 await t.test('reenvío y concurrencia reutilizan la misma versión',async()=>{
 const replies=await Promise.all(Array.from({length:3},()=>calculateForActor(actor,input)));
 assert.ok(replies.every(r=>r.id===receipt.id&&r.reused));
 assert.ok(replies.every(r=>r.data.results.filter(result=>result.matchId===resolvedDefault).length===1));
 assert.deepEqual(replies[0].data.rows,receipt.data.rows);
 assert.equal((await q('SELECT count(*)::int AS n FROM sports_management.standing_entries WHERE standing_version_id=$1',[receipt.id]))[0].n,3);
 });
 await t.test('empate sin resolver usa NULL conservando rango positivo único',async()=>{
 const fresh=await Promise.all(Array.from({length:3},()=>calculateForActor(actor,{groupId:group,matchdayId:days[0]})));
 const empty=fresh[0];assert.ok(fresh.every(r=>r.id===empty.id));
 assert.equal(empty.data.rows.filter(r=>r.rank===null).length,3);
 await assert.rejects(q("UPDATE sports_management.standing_versions SET status='VALIDATED',validated_by=$2 WHERE id=$1",[empty.id,actor]),/posiciones pendientes/);
 const persisted=await q('SELECT rank FROM sports_management.standing_entries WHERE standing_version_id=$1',[empty.id]);assert.equal(persisted.filter(r=>r.rank===null).length,3);
 });
 await t.test('cédula confirmada: eventos con procedencia y captura incompleta explícita',async()=>{
 const full=await calculateForActor(actor,{groupId:group,matchdayId:days[3]});
 assert.equal(full.data.events.length,4);assert.equal(full.data.events.filter(e=>e.reportId===report&&e.reportVersion===1).length,3);
 assert.equal(full.data.statistics.find(s=>s.teamId===teams[1])!.observedCautions,2);
 assert.equal(full.data.playerStatistics.unattributedEventIds.length,4);
 assert.equal(full.data.playerStatistics.players.length,0);
 assert.equal(full.data.statistics.find(s=>s.teamId===teams[2])!.observedCautions,0);
 assert.equal(full.data.statistics.find(s=>s.teamId===teams[0])!.officialCautions,null);
 });
 await t.test('corrección y retorno a insumos previos crean versiones sucesivas',async()=>{
 await q('UPDATE sports_management.match_results SET counts_in_standings=false,version=version+1 WHERE match_id=$1',[first]);
 const excluded=await calculateForActor(actor,input);assert.ok(excluded.version>receipt.version);
 await q('UPDATE sports_management.match_results SET counts_in_standings=true,version=version+1 WHERE match_id=$1',[first]);
 const restored=await calculateForActor(actor,input);assert.ok(restored.version>excluded.version);
 assert.equal((await readStandingsForActor(actor,input))[0].id,restored.id);
 });
 await t.test('lectura por contexto y denegación sin permiso',async()=>{
 assert.ok((await readStandingsForActor(actor,input)).some(v=>v.id===receipt.id));
 await assert.rejects(calculateForActor(randomUUID(),input));
 const otherLeague=await id("INSERT INTO sports_management.leagues(name) VALUES('Liga ajena sintética') RETURNING id");
 await q('UPDATE sports_management.user_roles SET league_id=$2 WHERE user_id=$1',[actor,otherLeague]);
 await assert.rejects(calculateForActor(actor,input),/FORBIDDEN/);
 await assert.rejects(readStandingsForActor(actor,input),/FORBIDDEN/);
 await q('UPDATE sports_management.user_roles SET league_id=$2 WHERE user_id=$1',[actor,league]);await assert.rejects(readStandingsForActor(actor,{groupId:randomUUID(),matchdayId:days[0]}));
 });
 await t.test('usa reglamento vinculado, rechaza borrador y restaura contexto',async()=>{
 const draft=await id('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,2) RETURNING id',[season]);
 assert.ok((await calculateForActor(actor,input)).reused);
 await q('UPDATE sports_management.season_categories SET competition_rule_id=$2 WHERE id=$1',[sc,draft]);
 await assert.rejects(calculateForActor(actor,input),/RULES_NOT_APPROVED/);
 await q('UPDATE sports_management.season_categories SET competition_rule_id=$2 WHERE id=$1',[sc,rule]);
 });
 await t.test('rechaza transacción de aislamiento insuficiente',async()=>{
 await assert.rejects(getPrisma().$transaction(tx=>calculateStandingsInTransaction(tx,actor,input)),/SERIALIZABLE_REQUIRED/);
 });
 await t.test('fallo posterior revierte resultado, versión, entradas y auditoría juntos',async()=>{
 const before=await q('SELECT count(*)::int AS n FROM sports_management.standing_versions');
 const auditBefore=await q('SELECT count(*)::int AS n FROM sports_management.audit_logs');
 const entriesBefore=await q('SELECT count(*)::int AS n FROM sports_management.standing_entries');
 await assert.rejects(getPrisma().$transaction(async tx=>{
 await tx.$executeRaw`SELECT set_config('app.user_id',${actor},true),set_config('app.reason','Fallo sintético',true)`;
 await tx.$executeRaw`UPDATE sports_management.match_results SET counts_in_standings=false,version=version+1 WHERE match_id=${first}::uuid`;
 await calculateStandingsInTransaction(tx,actor,input);throw Error('SYNTHETIC_ROLLBACK');
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable}),/SYNTHETIC_ROLLBACK/);
 assert.deepEqual(await q('SELECT count(*)::int AS n FROM sports_management.standing_versions'),before);
 assert.deepEqual(await q('SELECT count(*)::int AS n FROM sports_management.audit_logs'),auditBefore);
 assert.deepEqual(await q('SELECT count(*)::int AS n FROM sports_management.standing_entries'),entriesBefore);
 assert.equal((await q('SELECT counts_in_standings FROM sports_management.match_results WHERE match_id=$1',[first]))[0].counts_in_standings,true);
 });
 }finally{await db.end();await getPrisma().$disconnect();}
});

test('liguilla selecciona ocho equipos solo con temporada regular oficial completa', async () => {
 assert.equal(process.env.STANDINGS_ISOLATED,'1');
 const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
 const q = async (sql:string,args:unknown[]=[]) => (await db.query(sql,args)).rows;
 const id = async (sql:string,args:unknown[]=[]) => (await q(sql,args))[0].id as string;
 try {
  await q('BEGIN');
  const person=await id("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Liguilla','Sintética') RETURNING id");
  const actor=await id("INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password) VALUES($1,'playoff-synthetic','playoff@example.invalid','!disabled',false) RETURNING id",[person]);
  await q("SELECT set_config('app.user_id',$1,true),set_config('app.reason','Prueba liguilla',true)",[actor]);
  const league=await id("INSERT INTO sports_management.leagues(name) VALUES('Liga de liguilla sintética') RETURNING id");
  await q("UPDATE sports_management.leagues SET timezone='UTC' WHERE id=$1",[league]);
  const venue=await id("INSERT INTO sports_management.venues(league_id,code,name,address,is_league_sports_complex,match_duration_minutes,buffer_minutes) VALUES($1,'LIG-TEST','Cancha de prueba','Prueba',true,90,15) RETURNING id",[league]);
  await q("INSERT INTO sports_management.venue_availability(venue_id,type,starts_at,ends_at) VALUES($1,'AVAILABLE','2030-07-07T08:00:00Z','2030-07-07T20:00:00Z')",[venue]);
  const sport=await id("INSERT INTO sports_management.sports(code,name) VALUES('PLAYOFFTEST','Sintético') RETURNING id");
  const season=await id("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,'Liguilla','2030-01-01','2030-12-31') RETURNING id",[league,sport]);
  const role=await id("INSERT INTO sports_management.roles(code,name) VALUES('PLAYOFF_TEST','Prueba liguilla') RETURNING id");
  await q("INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT $1,id,false FROM sports_management.permissions WHERE module='competitions' AND action='READ'",[role]);
  await q("INSERT INTO sports_management.permissions(module,action) VALUES('competitions','APPROVE') ON CONFLICT DO NOTHING");
  await q("INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT $1,id,false FROM sports_management.permissions WHERE module='competitions' AND action='APPROVE'",[role]);
  await q("INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT $1,id,false FROM sports_management.permissions WHERE module='competitions' AND action='UPDATE' ON CONFLICT DO NOTHING",[role]);
  await q("INSERT INTO sports_management.permissions(module,action) VALUES('scheduling','UPDATE') ON CONFLICT DO NOTHING");
  await q("INSERT INTO sports_management.permissions(module,action) VALUES('scheduling','READ') ON CONFLICT DO NOTHING");
  await q("INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT $1,id,false FROM sports_management.permissions WHERE module='scheduling' AND action='UPDATE'",[role]);
  await q('INSERT INTO sports_management.user_roles(user_id,role_id,league_id) VALUES($1,$2,$3)',[actor,role,league]);
  await q("INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT r.id,p.id,true FROM sports_management.roles r CROSS JOIN sports_management.permissions p WHERE r.code='SCHEDULER' AND p.module='scheduling' AND p.action='UPDATE' ON CONFLICT DO NOTHING");
  await q("INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) SELECT r.id,p.id,true FROM sports_management.roles r CROSS JOIN sports_management.permissions p WHERE r.code='SCHEDULER' AND p.module='scheduling' AND p.action='READ' ON CONFLICT DO NOTHING");
  await q("INSERT INTO sports_management.user_roles(user_id,role_id,league_id) SELECT $1,id,$2 FROM sports_management.roles WHERE code='SCHEDULER'",[actor,league]);
  const schedulerPerson=await id("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Programador','Segundo') RETURNING id");
  const secondScheduler=await id("INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password) VALUES($1,'playoff-scheduler-2','playoff-scheduler-2@example.invalid','!disabled',false) RETURNING id",[schedulerPerson]);
  await q("INSERT INTO sports_management.user_roles(user_id,role_id,league_id) SELECT $1,id,$2 FROM sports_management.roles WHERE code='SCHEDULER'",[secondScheduler,league]);
  const rule=await id('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id',[season]);
  for(const [key,value] of Object.entries({points:{win:3,draw:1,loss:0},tieBreakers:['GOAL_DIFFERENCE','GOALS_FOR'],calendar:{rounds:1,playoff:{regularDeadline:'2030-06-30',format:{quarterfinals:'SINGLE',semifinals:'SINGLE',final:'SINGLE'},preliminaryTiebreaker:'PENALTIES',dates:['2030-07-07','2030-07-14','2030-07-21']}}}))
   await q('INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by) VALUES($1,$2,$3,$4)',[rule,key,JSON.stringify(value),actor]);
  await q("UPDATE sports_management.competition_rules SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1",[rule,actor]);
  const category=await id("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Categoría liguilla') RETURNING id",[league,sport]);
  const sc=await id("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date) VALUES($1,$2,$3,1,'OPEN','2030-01-01') RETURNING id",[season,category,rule]);
  const group=await id("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,'General') RETURNING id",[season,sc]);
  const teams:string[]=[];
  for(let n=0;n<10;n++){
   const club=await id('INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES($1,$2,$2) RETURNING id',[league,`playoff-club-${n}`]);
   await q("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,requested_by) VALUES($1,$2,$3,$4,'Azul',$5)",[season,club,league,`playoff-aff-${n}`,actor]);
   const team=await id('INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES($1,$2,$2) RETURNING id',[club,`playoff-team-${n}`]);
   teams.push(await id('INSERT INTO sports_management.season_teams(season_id,team_id,club_id,group_id,season_category_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[season,team,club,group,sc]));
  }
  const days:string[]=[]; for(let n=1;n<=9;n++)days.push(await id("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,$2,'2030-02-01'::date+($2-1)*7,'2030-02-01'::date+($2-1)*7) RETURNING id",[season,n]));
  const ids:string[]=[];
  let pendingResult: { match: string; homeScore: number; awayScore: number } | undefined;
  for(const p of roundRobin(teams,1).pairings){
   const m=await id("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,status_id) VALUES($1,$2,$3,$4,$5,$6,sports_management.get_match_status_id('FINISHED')) RETURNING id",[season,group,days[p.round-1],randomUUID(),p.home,p.away]);
   const homeWins=teams.indexOf(p.home)<teams.indexOf(p.away);
   if (ids.length === 0) pendingResult={match:m,homeScore:homeWins?1:0,awayScore:homeWins?0:1};
   else await q("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,$2,$3,'MATCH_REPORT',$4)",[m,homeWins?1:0,homeWins?0:1,actor]);
   ids.push(m);
  }
  await q('COMMIT');
  await q("SELECT set_config('app.user_id',$1,false),set_config('app.reason','Prueba liguilla',false)",[actor]);
  await assert.rejects(previewPlayoffQualifiersForActor(actor,season,sc),/OFFICIAL_RESULTS_INCOMPLETE/);
  await q("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,$2,$3,'MATCH_REPORT',$4)",[pendingResult!.match,pendingResult!.homeScore,pendingResult!.awayScore,actor]);
  await assert.rejects(previewPlayoffQualifiersForActor(actor,season,sc),/OFFICIAL_RESULTS_INCOMPLETE/);
  for(const match of ids) await q("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now())",[match,randomUUID(),actor]);
  const result=await previewPlayoffQualifiersForActor(actor,season,sc);
  assert.equal(result.qualified.length,8);
  assert.deepEqual(result.qualified.map(item=>item.teamId),teams.slice(0,8));
  await q('UPDATE sports_management.match_results SET counts_in_standings=false,version=version+1 WHERE match_id=$1',[ids[0]]);
  await q('UPDATE sports_management.match_results SET counts_in_standings=true,version=version+1 WHERE match_id=$1',[ids[0]]);
  const command={seasonId:season,categoryId:sc,fingerprint:result.fingerprint,groupOrder:[],operationId:randomUUID(),reason:'Aprobar llaves de prueba'};
  await q("UPDATE sports_management.seasons SET status='ACTIVE' WHERE id=$1",[season]);
  const seasonVersion=(await q('SELECT version FROM sports_management.seasons WHERE id=$1',[season]))[0].version;
  const closeInput={confirm:'CERRAR',reason:'Prueba cierre de liguilla pendiente',expectedSeasonVersion:seasonVersion};
  await assert.rejects(closeSeasonForActor(actor,season,closeInput),{code:'UNRESOLVED_PLAYOFF'});
  await assert.rejects(getPrisma().$transaction(tx=>assertPlayoffsComplete(tx,season)),{code:'UNRESOLVED_PLAYOFF'});
  await assert.rejects(confirmPlayoffBracketForActor(actor,command),/PLAYOFF_STANDINGS_CHANGED/);
  command.fingerprint=(await previewPlayoffQualifiersForActor(actor,season,sc)).fingerprint;
  await assert.rejects(confirmPlayoffBracketForActor(randomUUID(),command));
  await assert.rejects(confirmPlayoffBracketForActor(actor,{...command,fingerprint:'0'.repeat(64)}),/PLAYOFF_STANDINGS_CHANGED/);
  await assert.rejects(confirmPlayoffBracketForActor(actor,command),/PLAYOFF_STANDINGS_NOT_VALIDATED/);
  const validation={seasonId:season,categoryId:sc,fingerprint:command.fingerprint,reason:'Validar clasificación sintética'};
  await assert.rejects(validatePlayoffStandingsForActor(randomUUID(),validation));
  const validated=await validatePlayoffStandingsForActor(actor,validation);
  assert.equal(validated.validated.length,1);
  assert.deepEqual((await validatePlayoffStandingsForActor(actor,validation)).validated,validated.validated);
  assert.equal((await q("SELECT count(*)::int n FROM sports_management.audit_logs WHERE entity_id=$1 AND action='STANDINGS_VALIDATED'",[validated.validated[0].id]))[0].n,1);
  await q('UPDATE sports_management.match_results SET version=version+1 WHERE match_id=$1',[ids[0]]);
  await assert.rejects(confirmPlayoffBracketForActor(actor,command),/PLAYOFF_STANDINGS_CHANGED/);
  await assert.rejects(validatePlayoffStandingsForActor(actor,validation),/PLAYOFF_STANDINGS_CHANGED/);
  command.fingerprint=(await previewPlayoffQualifiersForActor(actor,season,sc)).fingerprint;
  await assert.rejects(confirmPlayoffBracketForActor(actor,command),/PLAYOFF_STANDINGS_NOT_VALIDATED/);
  await validatePlayoffStandingsForActor(actor,{...validation,fingerprint:command.fingerprint});
  await q(`CREATE FUNCTION pg_temp.reject_playoff_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PLAYOFF_BRACKET_CONFIRMED' THEN RAISE EXCEPTION 'fallo de auditoría sintético'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_playoff_audit BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_playoff_audit()`);
  try { await assert.rejects(confirmPlayoffBracketForActor(actor,command)); }
  finally { await q('DROP TRIGGER test_playoff_audit ON sports_management.audit_logs'); }
  assert.equal((await q('SELECT count(*)::int n FROM sports_management.competition_stages WHERE season_category_id=$1',[sc]))[0].n,0);
  const replies=await Promise.allSettled([confirmPlayoffBracketForActor(actor,command),confirmPlayoffBracketForActor(actor,command)]);
  assert.ok(replies.some(reply=>reply.status==='fulfilled'));
  const saved=await confirmPlayoffBracketForActor(actor,command);
  assert.equal(saved.reused,true);
  assert.equal((await q('SELECT count(*)::int AS n FROM sports_management.brackets WHERE stage_id=$1',[saved.id]))[0].n,7);
  const approvalAudit=await q("SELECT user_id,reason,new_data FROM sports_management.audit_logs WHERE entity_id=$1 AND action='PLAYOFF_BRACKET_CONFIRMED'",[saved.id]);
  assert.equal(approvalAudit.length,1); assert.equal(approvalAudit[0].user_id,actor); assert.equal(approvalAudit[0].reason,command.reason);
  assert.equal(approvalAudit[0].new_data.fingerprint,command.fingerprint);
  const official=(await previewPlayoffQualifiersForActor(actor,season,sc)).standingVersions;
  assert.deepEqual(approvalAudit[0].new_data.standingVersions,official);
  assert.deepEqual((await q('SELECT format FROM sports_management.competition_stages WHERE id=$1',[saved.id]))[0].format.standingVersions,official);
  await assert.rejects(getPrisma().$transaction(tx=>assertPlayoffsComplete(tx,season)),{code:'UNRESOLVED_PLAYOFF'});
  await assert.rejects(closeSeasonForActor(actor,season,closeInput),{code:'UNRESOLVED_PLAYOFF'});
  assert.equal((await q('SELECT status FROM sports_management.seasons WHERE id=$1',[season]))[0].status,'ACTIVE');
  const createInput={seasonId:season,categoryId:sc,reason:'Crear cuartos de prueba',homeChoices:{}};
  await assert.rejects(createPlayoffQuarterfinalsForActor(randomUUID(),createInput));
  assert.equal((await createPlayoffQuarterfinalsForActor(actor,createInput)).created,4);
  await assert.rejects(createPlayoffQuarterfinalsForActor(actor,createInput),/PLAYOFF_MATCHES_ALREADY_CREATED/);
  assert.equal((await q("SELECT count(*)::int AS n FROM sports_management.matches WHERE stage_id=$1 AND venue_id IS NULL AND starts_at IS NULL",[saved.id]))[0].n,4);
  const playoffMatch=(await q('SELECT bm.match_id,b.id AS bracket,b.next_bracket_id,b.next_slot,m.home_team_id FROM sports_management.bracket_matches bm JOIN sports_management.brackets b ON b.id=bm.bracket_id JOIN sports_management.matches m ON m.id=bm.match_id WHERE b.stage_id=$1 ORDER BY b.number LIMIT 1',[saved.id]))[0];
  await q("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('FINISHED') WHERE id=$1",[playoffMatch.match_id]);
  await q("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,2,0,'MATCH_REPORT',$2)",[playoffMatch.match_id,actor]);
  await q("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now())",[playoffMatch.match_id,randomUUID(),actor]);
  for(let n=0;n<2;n++) await getPrisma().$transaction(async tx=>{
   await tx.$queryRaw`SELECT set_config('app.user_id',${actor},true),set_config('app.reason','Avance sintético',true)`;
   assert.deepEqual(await advancePlayoffResultInTransaction(tx,playoffMatch.match_id),{code:'ADVANCED',winnerId:playoffMatch.home_team_id});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  const next=(await q('SELECT team_a_id,team_b_id FROM sports_management.brackets WHERE id=$1',[playoffMatch.next_bracket_id]))[0];
  assert.equal(playoffMatch.next_slot===1?next.team_a_id:next.team_b_id,playoffMatch.home_team_id);
  const penaltyMatch=(await q('SELECT bm.match_id,b.id AS bracket,b.team_a_id FROM sports_management.bracket_matches bm JOIN sports_management.brackets b ON b.id=bm.bracket_id WHERE b.stage_id=$1 AND b.number=3',[saved.id]))[0];
  await q("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('FINISHED') WHERE id=$1",[penaltyMatch.match_id]);
  await q("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,1,1,'MATCH_REPORT',$2)",[penaltyMatch.match_id,actor]);
  await q("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now())",[penaltyMatch.match_id,randomUUID(),actor]);
  const penalties={seasonId:season,bracketId:penaltyMatch.bracket,operationId:randomUUID(),firstScore:5,secondScore:4,reason:'Confirmar penales sintéticos'};
  await assert.rejects(confirmPlayoffPenaltiesForActor(randomUUID(),penalties));
  assert.deepEqual(await confirmPlayoffPenaltiesForActor(actor,penalties),{winnerId:penaltyMatch.team_a_id,replayed:false});
  assert.deepEqual(await confirmPlayoffPenaltiesForActor(actor,penalties),{winnerId:penaltyMatch.team_a_id,replayed:true});
  await assert.rejects(confirmPlayoffPenaltiesForActor(actor,{...penalties,secondScore:3}),/OPERATION_KEY_REUSED/);
  assert.equal((await q("SELECT count(*)::int AS n FROM sports_management.audit_logs WHERE entity_id=$1 AND action='PLAYOFF_PENALTIES_CONFIRMED'",[penaltyMatch.bracket]))[0].n,1);
  await assert.rejects(confirmPlayoffBracketForActor(actor,{...command,operationId:randomUUID()}),/PLAYOFF_ALREADY_CONFIRMED/);
  const secondPlayoff=(await q('SELECT bm.match_id FROM sports_management.bracket_matches bm JOIN sports_management.brackets b ON b.id=bm.bracket_id WHERE b.stage_id=$1 AND b.number=2',[saved.id]))[0];
  await q("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('FINISHED') WHERE id=$1",[secondPlayoff.match_id]);
  await q("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,1,0,'MATCH_REPORT',$2)",[secondPlayoff.match_id,actor]);
  await q("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now())",[secondPlayoff.match_id,randomUUID(),actor]);
  const pendingPenalty=(await q('SELECT bm.match_id,b.id AS bracket FROM sports_management.bracket_matches bm JOIN sports_management.brackets b ON b.id=bm.bracket_id WHERE b.stage_id=$1 AND b.number=4',[saved.id]))[0];
  await q("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('FINISHED') WHERE id=$1",[pendingPenalty.match_id]);
  await q("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,1,1,'MATCH_REPORT',$2)",[pendingPenalty.match_id,actor]);
  await q("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now())",[pendingPenalty.match_id,randomUUID(),actor]);
  const penaltiesPending={seasonId:season,bracketId:pendingPenalty.bracket,operationId:randomUUID(),firstScore:3,secondScore:5,reason:'Confirmar penales Preview'};
  const cases: {actor:string;season:string;category:string;expected:string[];venue?:string;secondScheduler?:string;advanceMatch?:string;penalties?:typeof penalties;penaltiesPending?:typeof penalties}[] = [{ actor, season, category:sc, expected:teams.slice(0,8), venue, secondScheduler, advanceMatch:secondPlayoff.match_id,penalties,penaltiesPending }];
  for (const [groupCount, teamCount] of [[2,5],[4,3],[8,2]] as const) {
   const cat=await id("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,$3) RETURNING id",[league,sport,`Liguilla ${groupCount} grupos`]);
   const participation=await id("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date) VALUES($1,$2,$3,$4,'OPEN','2030-01-01') RETURNING id",[season,cat,rule,groupCount+1]);
   const expected:string[]=[];
   for(let g=0;g<groupCount;g++) {
    const gid=await id('INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,$3) RETURNING id',[season,participation,`Grupo ${g}`]);
    const members:string[]=[];
    for(let n=0;n<teamCount;n++) {
     const label=`case-${groupCount}-${g}-${n}`;
     const club=await id('INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES($1,$2,$2) RETURNING id',[league,label]);
     await q("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,requested_by) VALUES($1,$2,$3,$4,'Azul',$5)",[season,club,league,label,actor]);
     const team=await id('INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES($1,$2,$2) RETURNING id',[club,label]);
     members.push(await id('INSERT INTO sports_management.season_teams(season_id,team_id,club_id,group_id,season_category_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[season,team,club,gid,participation]));
    }
    expected.push(...members.slice(0,8/groupCount));
    for(const p of roundRobin(members,1).pairings) {
     const match=await id("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,status_id) VALUES($1,$2,$3,$4,$5,$6,sports_management.get_match_status_id('FINISHED')) RETURNING id",[season,gid,days[p.round-1],randomUUID(),p.home,p.away]);
     const homeWins=members.indexOf(p.home)<members.indexOf(p.away);
     await q("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,$2,$3,'MATCH_REPORT',$4)",[match,homeWins?1:0,homeWins?0:1,actor]);
     await q("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now())",[match,randomUUID(),actor]);
    }
   }
   cases.push({actor,season,category:participation,expected});
  }
  assert.match(db.database!, /^pdgld48_test_[a-f0-9]{16}$/);
  await q(`COMMENT ON DATABASE "${db.database}" IS '${PREVIEW_MARKER}'`);
  await q("DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='sports_management' LOOP EXECUTE format('ALTER TABLE sports_management.%I ENABLE ROW LEVEL SECURITY',t.tablename); END LOOP; END $$");
  await provisionPreviewRuntime(db);
  await q("ALTER ROLE gestor_ligas_preview LOGIN PASSWORD 'synthetic-preview-only'");
  const runtime=new URL(process.env.DATABASE_URL!); runtime.username='gestor_ligas_preview'; runtime.password='synthetic-preview-only';
  const probe=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','tests/integration/playoff-preview-probe.ts'],{encoding:'utf8',env:{...process.env,DATABASE_URL:runtime.href,PLAYOFF_PROBE:JSON.stringify(cases)}});
  assert.equal(probe.status,0,`${probe.stdout}\n${probe.stderr}`.replaceAll(runtime.href,'[conexión omitida]'));
  const reserved=await q(`SELECT m.id,
    (SELECT count(*)::int FROM sports_management.venue_reservations vr WHERE vr.match_id=m.id AND vr.venue_id=$2) AS venues,
    (SELECT count(*)::int FROM sports_management.team_reservations tr WHERE tr.match_id=m.id AND tr.season_team_id IN (m.home_team_id,m.away_team_id)) AS teams
    FROM sports_management.matches m JOIN sports_management.competition_stages st ON st.id=m.stage_id
    WHERE st.season_category_id=$1 AND m.venue_id=$2 AND m.starts_at='2030-07-07T12:00:00Z'`,[cases[1].category,venue]);
  assert.equal(reserved.length,1);
  assert.equal(reserved[0].venues,1);
  assert.equal(reserved[0].teams,2);
  const concurrent=await q(`SELECT m.id,
    (SELECT count(*)::int FROM sports_management.venue_reservations vr WHERE vr.match_id=m.id AND vr.venue_id=$2) AS venues,
    (SELECT count(*)::int FROM sports_management.team_reservations tr WHERE tr.match_id=m.id AND tr.season_team_id IN (m.home_team_id,m.away_team_id)) AS teams
    FROM sports_management.matches m JOIN sports_management.competition_stages st ON st.id=m.stage_id
    WHERE st.season_category_id=$1 AND m.starts_at='2030-07-07T15:00:00Z'`,[cases[1].category,venue]);
  assert.equal(concurrent.length,1);
  assert.equal(concurrent[0].venues,1);
  assert.equal(concurrent[0].teams,2);
  // Un reglamento independiente evita alterar los casos anteriores de Preview.
  const automaticVenue=await id("INSERT INTO sports_management.venues(league_id,code,name,address,is_league_sports_complex,match_duration_minutes,buffer_minutes) VALUES($1,'AUTO-LIG','Cancha neutral automática','Prueba',true,90,15) RETURNING id",[league]);
  await q("INSERT INTO sports_management.venue_availability(venue_id,type,starts_at,ends_at) VALUES($1,'AVAILABLE','2030-07-07T08:00:00Z','2030-07-07T20:00:00Z')",[automaticVenue]);
  const autoRule=await id('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,2) RETURNING id',[season]);
  await q(`INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by)
    SELECT $1,parameter_key,CASE WHEN parameter_key='calendar' THEN jsonb_set(parameter_value::jsonb,'{playoff,venuePolicy}',jsonb_build_object('mode','NEUTRAL','venueIds',jsonb_build_array($3::text))) ELSE parameter_value::jsonb END,validated_by
    FROM sports_management.competition_rule_parameters WHERE competition_rule_id=$2`,[autoRule,rule,automaticVenue]);
  await q("UPDATE sports_management.competition_rules SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1",[autoRule,actor]);
  await q('UPDATE sports_management.season_categories SET competition_rule_id=$2 WHERE id=$1',[cases[2].category,autoRule]);
  const autoQualifiers=await previewPlayoffQualifiersForActor(actor,season,cases[2].category);
  await validatePlayoffStandingsForActor(actor,{seasonId:season,categoryId:cases[2].category,fingerprint:autoQualifiers.fingerprint,reason:'Validar clasificación automática'});
  const groupOrder=(await q('SELECT id FROM sports_management.groups WHERE season_category_id=$1 ORDER BY name',[cases[2].category])).map(row=>row.id);
  const autoBracket=await confirmPlayoffBracketForActor(actor,{seasonId:season,categoryId:cases[2].category,fingerprint:autoQualifiers.fingerprint,groupOrder,operationId:randomUUID(),reason:'Aprobar llaves automáticas'});
  const auto=await createPlayoffQuarterfinalsForActor(actor,{seasonId:season,categoryId:cases[2].category,reason:'Programar cuartos automáticos',homeChoices:{}});
  assert.equal(auto.created,4); assert.equal(auto.scheduled,4); assert.equal(auto.pending,0);
  const autoMatches=await q(`SELECT m.id,m.version,m.venue_id,m.starts_at,
    (SELECT count(*)::int FROM sports_management.venue_reservations r WHERE r.match_id=m.id) venues,
    (SELECT count(*)::int FROM sports_management.team_reservations r WHERE r.match_id=m.id) teams
    FROM sports_management.matches m WHERE m.stage_id=$1`,[autoBracket.id]);
  assert.equal(autoMatches.length,4);
  for(const match of autoMatches) { assert.equal(match.venue_id,automaticVenue); assert.ok(match.starts_at); assert.equal(match.venues,1); assert.equal(match.teams,2); }
  await getPrisma().$transaction(async tx=>{
    const match=autoMatches[0];
    const slots=await getRescheduleSlotsInTransaction(tx,actor,{matchId:match.id,venueId:venue,date:'2030-07-07',expectedVersion:match.version});
    assert.deepEqual(slots,[]);
    await assert.rejects(rescheduleAbsentMatchInTransaction(tx,actor,{matchId:match.id,operationId:randomUUID(),expectedVersion:match.version,venueId:venue,startsAtLocal:'2030-07-07T18:00',reason:'Cambio fuera de canchas neutrales'}),{code:'VENUE_STAGE'});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
  const homeRule=await id('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,3) RETURNING id',[season]);
  await q(`INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by)
    SELECT $1,parameter_key,CASE WHEN parameter_key='calendar' THEN jsonb_set(parameter_value::jsonb,'{playoff,venuePolicy}','{"mode":"HOME"}'::jsonb) ELSE parameter_value::jsonb END,validated_by
    FROM sports_management.competition_rule_parameters WHERE competition_rule_id=$2`,[homeRule,rule]);
  await q("UPDATE sports_management.competition_rules SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1",[homeRule,actor]);
  await q('UPDATE sports_management.season_categories SET competition_rule_id=$2 WHERE id=$1',[cases[3].category,homeRule]);
  for(const [index,team] of cases[3].expected.entries()) {
    const club=(await q('SELECT club_id FROM sports_management.season_teams WHERE id=$1',[team]))[0].club_id;
    const field=await id("INSERT INTO sports_management.venues(league_id,code,name,address,is_league_sports_complex,owner_club_id,match_duration_minutes,buffer_minutes) VALUES($1,$2,$2,'Prueba',false,$3,90,15) RETURNING id",[league,`HOME-${index}`,club]);
    await q("INSERT INTO sports_management.venue_availability(venue_id,type,starts_at,ends_at) VALUES($1,'AVAILABLE','2030-07-07T08:00:00Z','2030-07-07T20:00:00Z')",[field]);
  }
  const homeQualifiers=await previewPlayoffQualifiersForActor(actor,season,cases[3].category);
  await validatePlayoffStandingsForActor(actor,{seasonId:season,categoryId:cases[3].category,fingerprint:homeQualifiers.fingerprint,reason:'Validar clasificación de local'});
  const homeOrder=(await q('SELECT id FROM sports_management.groups WHERE season_category_id=$1 ORDER BY name',[cases[3].category])).map(row=>row.id);
  const homeBracket=await confirmPlayoffBracketForActor(actor,{seasonId:season,categoryId:cases[3].category,fingerprint:homeQualifiers.fingerprint,groupOrder:homeOrder,operationId:randomUUID(),reason:'Aprobar llaves con local'});
  const choices=await q('SELECT id,team_a_id FROM sports_management.brackets WHERE stage_id=$1 AND number BETWEEN 1 AND 4',[homeBracket.id]);
  // Uno de los locales no tiene cancha propia activa: la liga le asigna un complejo.
  const assignedTeam=choices[0].team_a_id;
  await q('UPDATE sports_management.venues SET is_active=false WHERE owner_club_id=(SELECT club_id FROM sports_management.season_teams WHERE id=$1)',[assignedTeam]);
  const assignedVenue=await id("INSERT INTO sports_management.venues(league_id,code,name,address,is_league_sports_complex,match_duration_minutes,buffer_minutes) VALUES($1,'HOME-ASSIGNED','Cancha asignada por liga','Prueba',true,90,15) RETURNING id",[league]);
  await q("INSERT INTO sports_management.venue_availability(venue_id,type,starts_at,ends_at) VALUES($1,'AVAILABLE','2030-07-07T08:00:00Z','2030-07-07T20:00:00Z')",[assignedVenue]);
  await q("INSERT INTO sports_management.home_venue_assignments(season_team_id,venue_id,weekday,start_time,starts_at,ends_at) VALUES($1,$2,7,'12:00','2030-07-07','2030-07-07')",[assignedTeam,assignedVenue]);
  const homeAuto=await createPlayoffQuarterfinalsForActor(actor,{seasonId:season,categoryId:cases[3].category,reason:'Programar canchas de local',homeChoices:Object.fromEntries(choices.map(row=>[row.id,row.team_a_id]))});
  assert.equal(homeAuto.scheduled,4); assert.equal(homeAuto.pending,0);
  const homeMatches=await q(`SELECT m.id,m.version,m.home_team_id,m.venue_id,m.starts_at,v.owner_club_id,t.club_id,
    (SELECT count(*)::int FROM sports_management.venue_reservations r WHERE r.match_id=m.id) venues,
    (SELECT count(*)::int FROM sports_management.team_reservations r WHERE r.match_id=m.id) teams
    FROM sports_management.matches m JOIN sports_management.venues v ON v.id=m.venue_id JOIN sports_management.season_teams t ON t.id=m.home_team_id WHERE m.stage_id=$1`,[homeBracket.id]);
  assert.equal(homeMatches.length,4);
  for(const match of homeMatches) {
    if(match.home_team_id===assignedTeam) assert.equal(match.venue_id,assignedVenue);
    else assert.equal(match.owner_club_id,match.club_id);
    assert.ok(match.starts_at); assert.equal(match.venues,1); assert.equal(match.teams,2);
  }
  const assignedMatch=homeMatches.find(match=>match.home_team_id===assignedTeam);
  assert.ok(assignedMatch);
  await getPrisma().$transaction(async tx=>{
    const slots=await getRescheduleSlotsInTransaction(tx,actor,{matchId:assignedMatch.id,venueId:assignedVenue,date:'2030-07-07',expectedVersion:assignedMatch.version});
    assert.ok(slots.some(slot=>slot.value==='2030-07-07T15:00'));
    const moved=await rescheduleAbsentMatchInTransaction(tx,actor,{matchId:assignedMatch.id,operationId:randomUUID(),expectedVersion:assignedMatch.version,venueId:assignedVenue,startsAtLocal:'2030-07-07T15:00',reason:'Cambiar horario en cancha asignada'});
    assert.equal(moved.replayed,false);
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
  const movedReservations=await q(`SELECT m.starts_at,m.venue_id,
    (SELECT count(*)::int FROM sports_management.venue_reservations r WHERE r.match_id=m.id) venues,
    (SELECT count(*)::int FROM sports_management.team_reservations r WHERE r.match_id=m.id) teams
    FROM sports_management.matches m WHERE m.id=$1`,[assignedMatch.id]);
  assert.equal(movedReservations[0].starts_at.toISOString(),'2030-07-07T15:00:00.000Z');
  assert.equal(movedReservations[0].venue_id,assignedVenue); assert.equal(movedReservations[0].venues,1); assert.equal(movedReservations[0].teams,2);
  const semifinalMatches=await q('SELECT bm.match_id FROM sports_management.bracket_matches bm JOIN sports_management.brackets b ON b.id=bm.bracket_id WHERE b.stage_id=$1 AND b.number IN (5,6) ORDER BY b.number',[saved.id]);
  assert.equal(semifinalMatches.length,2);
  for(const item of semifinalMatches) {
   await q("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('FINISHED') WHERE id=$1",[item.match_id]);
   await q("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,2,0,'MATCH_REPORT',$2)",[item.match_id,actor]);
   await q("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now())",[item.match_id,randomUUID(),actor]);
   await getPrisma().$transaction(async tx=>{
    await tx.$queryRaw`SELECT set_config('app.user_id',${actor},true),set_config('app.reason','Semifinal sintética',true)`;
    assert.equal((await advancePlayoffResultInTransaction(tx,item.match_id)).code,'ADVANCED');
   },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }
  assert.equal((await createPlayoffQuarterfinalsForActor(actor,{seasonId:season,categoryId:sc,round:'final',reason:'Crear final sintética',homeChoices:{}})).created,1);
  await assert.rejects(createPlayoffQuarterfinalsForActor(actor,{seasonId:season,categoryId:sc,round:'final',reason:'Crear final sintética',homeChoices:{}}),/PLAYOFF_MATCHES_ALREADY_CREATED/);
  const finalMatch=(await q('SELECT bm.match_id,m.home_team_id,m.away_team_id FROM sports_management.bracket_matches bm JOIN sports_management.brackets b ON b.id=bm.bracket_id JOIN sports_management.matches m ON m.id=bm.match_id WHERE b.stage_id=$1 AND b.number=7',[saved.id]))[0];
  await q("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('FINISHED') WHERE id=$1",[finalMatch.match_id]);
  await q("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,2,0,'MATCH_REPORT',$2)",[finalMatch.match_id,actor]);
  await q("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now())",[finalMatch.match_id,randomUUID(),actor]);
  for(let n=0;n<2;n++) await getPrisma().$transaction(async tx=>{
   await tx.$queryRaw`SELECT set_config('app.user_id',${actor},true),set_config('app.reason','Final sintética',true)`;
   assert.deepEqual(await advancePlayoffResultInTransaction(tx,finalMatch.match_id),{code:'ADVANCED',winnerId:finalMatch.home_team_id});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  const finalRow=(await q('SELECT winner_id FROM sports_management.brackets WHERE stage_id=$1 AND number=7',[saved.id]))[0];
  assert.equal(finalRow.winner_id,finalMatch.home_team_id);
  const championName=(await q('SELECT t.name FROM sports_management.season_teams st JOIN sports_management.teams t ON t.id=st.team_id WHERE st.id=$1',[finalMatch.home_team_id]))[0].name;
  const finalView=await readConfirmedPlayoffBracketForActor(actor,season,sc);
  assert.ok(finalView.confirmed);
  const runnerUpName=(await q('SELECT t.name FROM sports_management.season_teams st JOIN sports_management.teams t ON t.id=st.team_id WHERE st.id=$1',[finalMatch.away_team_id]))[0].name;
  if(finalView.confirmed) { assert.equal(finalView.champion,championName); assert.equal(finalView.runnerUp,runnerUpName); }
  const afterPlayoffs=await previewPlayoffQualifiersForActor(actor,season,sc);
  assert.equal(afterPlayoffs.fingerprint,command.fingerprint,'los resultados de liguilla no cambian el cálculo de fase regular');
  assert.deepEqual(afterPlayoffs.qualified.map(team=>team.teamId),teams.slice(0,8));
 } finally { await db.end(); await getPrisma().$disconnect(); }
});
