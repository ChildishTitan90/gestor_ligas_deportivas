import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { roundRobin } from '../src/features/scheduling/generator';

// Solo añade una temporada sintética a la liga DEMO local existente.
const url=new URL(process.env.DIRECT_URL ?? '');
if(!['localhost','127.0.0.1','::1'].includes(url.hostname) || url.pathname!=='/gestor_ligas_dev') throw Error('LOCAL_DEMO_DATABASE_REQUIRED');
const db=new pg.Client({connectionString:url.href});
await db.connect();
const q=async(sql:string,values:unknown[]=[]) => (await db.query(sql,values)).rows;
const id=async(sql:string,values:unknown[]=[]) => (await q(sql,values))[0].id as string;
const league='54000000-0000-4000-8000-000000000001';
try {
 await q('BEGIN');
 const [demo]=await q('SELECT id FROM sports_management.leagues WHERE id=$1 AND name=$2',[league,'DEMO Liga de Fútbol Morelia']);
 const [actor]=await q('SELECT id FROM sports_management.users WHERE username=$1 AND is_active',[ 'demo-admin' ]);
 if(!demo||!actor) throw Error('DEMO_PROFILE_REQUIRED');
 const [existing]=await q('SELECT id FROM sports_management.seasons WHERE league_id=$1 AND name=$2',[league,'DEMO Liguilla 2030']);
 if(existing) throw Error('DEMO_PLAYOFF_ALREADY_EXISTS');
 await q("SELECT set_config('app.user_id',$1,true),set_config('app.reason','Preparar demostración local de liguilla',true)",[actor.id]);
 const [sport]=await q('SELECT sport_id FROM sports_management.seasons WHERE league_id=$1 ORDER BY start_date LIMIT 1',[league]);
 if(!sport) throw Error('DEMO_SPORT_REQUIRED');
 const season=await id("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,'DEMO Liguilla 2030','2030-01-01','2030-12-31') RETURNING id",[league,sport.sport_id]);
 const rule=await id('INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES($1,1) RETURNING id',[season]);
 const calendar={rounds:1,matchDurationMinutes:90,complexOnlyFinalRounds:0,playoff:{regularDeadline:'2030-06-30',format:{quarterfinals:'SINGLE',semifinals:'SINGLE',final:'SINGLE'},preliminaryTiebreaker:'PENALTIES',dates:['2030-07-07','2030-07-14','2030-07-21']}};
 for(const [key,value] of Object.entries({points:{win:3,draw:1,loss:0},tieBreakers:['GOAL_DIFFERENCE','GOALS_FOR'],calendar}))
  await q('INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by) VALUES($1,$2,$3,$4)',[rule,key,JSON.stringify(value),actor.id]);
 await q("UPDATE sports_management.competition_rules SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1",[rule,actor.id]);
 const category=await id("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'DEMO Liguilla Libre') RETURNING id",[league,sport.sport_id]);
 const sc=await id("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date,competition_format) VALUES($1,$2,$3,1,'OPEN','2030-01-01','GENERAL_TABLE') RETURNING id",[season,category,rule]);
 const group=await id("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,'General') RETURNING id",[season,sc]);
 const teams:string[]=[];
 for(const [n,name] of ['Tigres','Pumas','Monarcas','Juárez','Venados','Águilas','Halcones','Leones'].entries()) {
  const ref=`DEMO-LIGUILLA-2030-${n+1}`;
  const club=await id('INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES($1,$2,$3) RETURNING id',[league,`${ref}-C`,name]);
  await q("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by) VALUES($1,$2,$3,$4,'Azul','APPROVED',$5)",[season,club,league,`${ref}-A`,actor.id]);
  const team=await id('INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES($1,$2,$3) RETURNING id',[club,`${ref}-T`,name]);
  const st=await id("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,group_id,status) VALUES($1,$2,$3,$4,$5,'REGISTERED') RETURNING id",[season,team,club,sc,group]);
  teams.push(st);
 }
 const days:string[]=[];
 for(let n=1;n<=7;n++) days.push(await id("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,$2,'2030-02-03'::date+($2-1)*7,'2030-02-03'::date+($2-1)*7) RETURNING id",[season,n]));
 for(const p of roundRobin(teams,1).pairings) {
  const m=await id("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,status_id) VALUES($1,$2,$3,$4,$5,$6,sports_management.get_match_status_id('FINISHED')) RETURNING id",[season,group,days[p.round-1],`DEMO-${randomUUID()}`,p.home,p.away]);
  const homeWins=teams.indexOf(p.home)<teams.indexOf(p.away);
  await q("INSERT INTO sports_management.match_results(match_id,home_score,away_score,source,validated_by) VALUES($1,$2,$3,'MATCH_REPORT',$4)",[m,homeWins?1:0,homeWins?0:1,actor.id]);
  await q("INSERT INTO sports_management.match_reports(match_id,client_id,captured_by,source,status,confirmed_at) VALUES($1,$2,$3,'PAPER','CONFIRMED',now())",[m,randomUUID(),actor.id]);
 }
 for(const [index,name] of ['Estadio Morelos','Estadio Universitario'].entries()) {
  const venue=await id("INSERT INTO sports_management.venues(league_id,code,name,address,is_league_sports_complex,match_duration_minutes,buffer_minutes) VALUES($1,$2,$3,'Demostración local',true,90,15) RETURNING id",[league,`DEMO-LIGUILLA-${index+1}`,name]);
  for(const date of calendar.playoff.dates) await q("INSERT INTO sports_management.venue_availability(venue_id,type,starts_at,ends_at) VALUES($1,'AVAILABLE',($2::date + time '14:00') AT TIME ZONE 'UTC',($2::date + time '23:00') AT TIME ZONE 'UTC')",[venue,date]);
 }
 await q('COMMIT');
 console.log(JSON.stringify({season,category:sc,group,teams:teams.length,matches:28,seasonName:'DEMO Liguilla 2030'}));
} catch(error) {await q('ROLLBACK');throw error;} finally {await db.end();}
