import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../../src/server/db/prisma';
import { calculateForActor, calculateStandingsInTransaction, readStandingsForActor } from '../../src/features/standings/server/service';

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
