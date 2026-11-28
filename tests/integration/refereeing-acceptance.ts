import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type pg from "pg";
import {getPrisma} from "../../src/server/db/prisma";
import {mutateRefereeing,recoverRefereeOperation,assessAssignment} from "../../src/features/referees/server/service";
import {readRefereeClubQuotas} from "../../src/features/referees/server/club-quota";
import {assertOwnRefereeAssignment} from "../../src/server/auth/authorization-domain";

type Context={db:pg.Client;actors:Record<string,string>;people:Record<string,string>;league:string;season:string;sc:string;group:string;clubs:string[];referee:string;version:string};
export async function verifyRefereeingAcceptance(c:Context){
  const {db,actors,league,season,sc,group,clubs}=c,prisma=getPrisma(),checks:string[]=[];
  const scalar=async(sql:string,values:unknown[]=[])=>String((await db.query(sql,values)).rows[0].id);
  const cmd=(kind:string,more:Record<string,unknown>)=>({kind,leagueId:league,seasonId:season,operationKey:randomUUID(),reason:"PDGLD-143: comprobación sintética",...more});
  const version=async(id:string)=>Number((await db.query("SELECT version FROM sports_management.referees WHERE id=$1",[id])).rows[0].version);
  const assess=(match:string,ref:string)=>prisma.$transaction(tx=>assessAssignment(tx,match,ref));
  async function newMatch(start="2026-12-06T16:00Z",end="2026-12-06T18:00Z"){
    const teams=[];
    for(const club of clubs.slice(1,3)){
      const team=await scalar("INSERT INTO sports_management.teams(club_id,name,reference_number) VALUES($1,'Equipo sintético',$2) RETURNING id",[club,randomUUID()]);
      const st=await scalar("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,status) VALUES($1,$2,$3,$4,'REGISTERED') RETURNING id",[season,team,club,sc]);
      await db.query("UPDATE sports_management.season_teams SET group_id=$2 WHERE id=$1",[st,group]);teams.push(st);
    }
    const venue=await scalar("INSERT INTO sports_management.venues(league_id,name,code,address,match_duration_minutes) VALUES($1,'Cancha sintética',$2,'Sin domicilio real',120) RETURNING id",[league,randomUUID()]);
    await db.query("INSERT INTO sports_management.venue_availability(venue_id,starts_at,ends_at,type) VALUES($1,'2026-12-05','2026-12-11','AVAILABLE')",[venue]);
    const day=await scalar("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) SELECT $1,coalesce(max(number),0)+1,'2026-12-06','2026-12-06' FROM sports_management.matchdays WHERE season_id=$1 RETURNING id",[season]);
    return scalar("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,sports_management.get_match_status_id('SCHEDULED')) RETURNING id",[season,group,day,`143-${randomUUID()}`,teams[0],teams[1],venue,start,end]);
  }
  async function newRef(active=true,available=true,club=clubs[0]){
    const person=await scalar("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Árbitro','Sintético') RETURNING id");
    const ref=await scalar("INSERT INTO sports_management.referees(person_id,is_active) VALUES($1,$2) RETURNING id",[person,active]);
    await db.query("INSERT INTO sports_management.club_season_referees(referee_id,season_id,club_id) VALUES($1,$2,$3)",[ref,season,club]);
    if(available)await mutateRefereeing(actors.comision,cmd("availability",{refereeId:ref,expectedVersion:await version(ref),startsAt:"2026-12-05T00:00:00Z",endsAt:"2026-12-11T00:00:00Z",available:true}));
    return ref;
  }
  // Un cruce entre grupos solo es válido cuando pertenece a una llave real de liguilla.
  const otherGroup=await scalar("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,$3) RETURNING id",[season,sc,`B-${randomUUID()}`]);
  async function otherGroupClub(){
    const club=await scalar("INSERT INTO sports_management.clubs(league_id,name,reference_number) VALUES($1,'Club de grupo B',$2) RETURNING id",[league,randomUUID()]);
    await db.query("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by) VALUES($1,$2,$3,$4,'Sintético','APPROVED',$5)",[season,club,league,randomUUID(),actors.comision]);
    const team=await scalar("INSERT INTO sports_management.teams(club_id,name,reference_number) VALUES($1,'Equipo B',$2) RETURNING id",[club,randomUUID()]);
    const entry=await scalar("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,status) VALUES($1,$2,$3,$4,'REGISTERED') RETURNING id",[season,team,club,sc]);
    await db.query('UPDATE sports_management.season_teams SET group_id=$2 WHERE id=$1',[entry,otherGroup]);
    return {club,entry};
  }
  const visitor=await otherGroupClub(),nonPlaying=await otherGroupClub();
  const knockout=await newMatch('2026-12-10T16:00Z','2026-12-10T18:00Z');
  await assert.rejects(db.query('UPDATE sports_management.matches SET away_team_id=$2 WHERE id=$1',[knockout,visitor.entry]),/En fase regular ambos teams/);
  const neutral=await newRef(),refA=await newRef(true,true,clubs[3]),refB=await newRef(true,true,nonPlaying.club);
  const stage=await scalar(`INSERT INTO sports_management.competition_stages(season_id,season_category_id,competition_rule_id,name,sort_order,format)
    SELECT $1,$2,competition_rule_id,'Liguilla de prueba',coalesce((SELECT max(sort_order)+1 FROM sports_management.competition_stages WHERE season_category_id=$2),1),'{"kind":"PLAYOFF_8"}'::jsonb
    FROM sports_management.season_categories WHERE id=$2 RETURNING id`,[season,sc]);
  const home=(await db.query('SELECT home_team_id FROM sports_management.matches WHERE id=$1',[knockout])).rows[0].home_team_id;
  const bracket=await scalar('INSERT INTO sports_management.brackets(stage_id,season_id,number,team_a_id,team_b_id) VALUES($1,$2,1,$3,$4) RETURNING id',[stage,season,home,visitor.entry]);
  await db.query('UPDATE sports_management.matches SET stage_id=$2,away_team_id=$3 WHERE id=$1',[knockout,stage,visitor.entry]);
  assert.ok((await assess(knockout,neutral)).blockers.some(b=>b.code==='INVALID_TEAMS'));
  await db.query('INSERT INTO sports_management.bracket_matches(bracket_id,match_id,leg_number) VALUES($1,$2,1)',[bracket,knockout]);
  assert.ok(!(await assess(knockout,neutral)).blockers.some(b=>b.code==='INVALID_TEAMS'));
  for(const ref of [refA,refB])assert.ok((await assess(knockout,ref)).blockers.some(b=>b.code==='CLUB_IN_GROUP'));
  const knockoutProposal=await mutateRefereeing(actors.programador,cmd('propose',{refereeId:neutral,matchId:knockout,expectedMatchVersion:1}));
  await mutateRefereeing(actors.comision,cmd('approve',{assignmentId:knockoutProposal.id,expectedVersion:knockoutProposal.version,expectedMatchVersion:1}));
  assert.equal((await db.query('SELECT status FROM sports_management.referee_assignments WHERE id=$1',[knockoutProposal.id])).rows[0].status,'APPROVED');
  checks.push('liguilla-grupos-distintos-imparcialidad-y-aprobacion');
  // Cuotas reales: cinco contextos independientes y registros no válidos fuera del conteo.
  for(const [count,required] of [[0,0],[1,1],[4,1],[5,2],[9,3]]){
    const club=await scalar("INSERT INTO sports_management.clubs(league_id,name,reference_number) VALUES($1,'Cuota sintética',$2) RETURNING id",[league,randomUUID()]);
    await db.query("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by) VALUES($1,$2,$3,$4,'Sintético','APPROVED',$5)",[season,club,league,randomUUID(),actors.comision]);
    for(let n=0;n<count;n++){const team=await scalar("INSERT INTO sports_management.teams(club_id,name,reference_number) VALUES($1,'Cuota',$2) RETURNING id",[club,randomUUID()]);await db.query("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,status) VALUES($1,$2,$3,$4,'REGISTERED')",[season,team,club,sc]);}
    const quota=await prisma.$transaction(async tx=>(await readRefereeClubQuotas(tx,season,[club]))[0]);assert.equal(quota.registeredTeams,count);assert.equal(Math.ceil(quota.registeredTeams/4),required);
    const excluded=await scalar("INSERT INTO sports_management.teams(club_id,name,reference_number,status) VALUES($1,'Inactivo excluido',$2,'INACTIVE') RETURNING id",[club,randomUUID()]);
    await db.query("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,status) VALUES($1,$2,$3,$4,'REGISTERED')",[season,excluded,club,sc]);
    const withdrawn=await scalar("INSERT INTO sports_management.teams(club_id,name,reference_number) VALUES($1,'Retirado excluido',$2) RETURNING id",[club,randomUUID()]);
    const withdrawnEnrollment=await scalar("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,status) VALUES($1,$2,$3,$4,'REGISTERED') RETURNING id",[season,withdrawn,club,sc]);
    await db.query("UPDATE sports_management.season_teams SET group_id=$2,status='WITHDRAWN' WHERE id=$1",[withdrawnEnrollment,group]);
    assert.equal((await prisma.$transaction(tx=>readRefereeClubQuotas(tx,season,[club])))[0].registeredTeams,count);
    const otherSeason=await scalar("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) SELECT league_id,sport_id,$2,start_date,end_date FROM sports_management.seasons WHERE id=$1 RETURNING id",[season,`Otro contexto sintético ${count}`]);
    assert.equal((await prisma.$transaction(tx=>readRefereeClubQuotas(tx,otherSeason,[club]))).length,0);
  }checks.push("cuotas-0-1-4-5-9-contextos-aislados");
  const match=await newMatch(),ref=await newRef(),inactive=await newRef(false),uncovered=await newRef(true,false);
  // El equipo del club presentador no disputa el encuentro; basta pertenecer
  // al grupo completo. La regla se conserva incluso si es el único grupo.
  const conflictRef=await newRef(true,true,clubs[3]);
  const groupName=(await db.query("SELECT name FROM sports_management.groups WHERE id=$1",[group])).rows[0].name;
  await db.query("UPDATE sports_management.groups SET name='Único' WHERE id=$1",[group]);
  try{
    assert.ok((await assess(match,conflictRef)).blockers.some(b=>b.code==='CLUB_IN_GROUP'));
    await assert.rejects(mutateRefereeing(actors.comision,cmd('assign',{refereeId:conflictRef,matchId:match,expectedMatchVersion:1})),e=>e instanceof Error&&'code'in e&&e.code==='CLUB_IN_GROUP');
  }finally{await db.query("UPDATE sports_management.groups SET name=$2 WHERE id=$1",[group,groupName]);}
  checks.push('grupo-unico-club-con-tercer-equipo-no-contendiente');
  for(const [id,code]of [[inactive,"INACTIVE"],[uncovered,"UNKNOWN_AVAILABILITY"]])assert.ok((await assess(match,id)).blockers.some(b=>b.code===code));
  const blocked=await newRef();await mutateRefereeing(actors.comision,cmd("availability",{refereeId:blocked,expectedVersion:await version(blocked),startsAt:"2026-12-06T16:00:00Z",endsAt:"2026-12-06T18:00:00Z",available:false}));assert.ok((await assess(match,blocked)).blockers.some(b=>b.code==="UNAVAILABLE"));
  // Añadir disponibilidad más tarde tampoco sobrescribe la excepción.
  await mutateRefereeing(actors.comision,cmd("availability",{refereeId:blocked,expectedVersion:await version(blocked),startsAt:"2026-12-06T14:00:00Z",endsAt:"2026-12-06T20:00:00Z",available:true}));
  assert.equal((await assess(match,blocked)).availability,"UNAVAILABLE");
  for(const [start,end] of [["14:00","16:00"],["18:00","20:00"]]){
    const adjacent=await newMatch(`2026-12-06T${start}Z`,`2026-12-06T${end}Z`);
    assert.equal((await assess(adjacent,blocked)).availability,"COVERED");
  }
  await assert.rejects(mutateRefereeing(actors.programador,cmd("propose",{refereeId:inactive,matchId:match,expectedMatchVersion:1})),e=>e instanceof Error&&"code"in e&&e.code==="INACTIVE");
  const incomplete=await newMatch("2026-12-07T16:00Z","2026-12-07T18:00Z");await db.query("UPDATE sports_management.matches SET starts_at=NULL,ends_at=NULL,reserved_until=NULL,status_id=sports_management.get_match_status_id('UNSCHEDULED') WHERE id=$1",[incomplete]);assert.ok((await assess(incomplete,ref)).blockers.some(b=>b.code==="INVALID_TIME"));
  checks.push("actividad-disponibilidad-horario-incompleto");
  const assignment=cmd("assign",{refereeId:ref,matchId:match,expectedMatchVersion:1});
  await assert.rejects(mutateRefereeing(actors.programador,assignment));await assert.rejects(mutateRefereeing(actors.lector,assignment));await assert.rejects(mutateRefereeing(actors.ajeno,assignment));
  const race=await Promise.allSettled([mutateRefereeing(actors.comision,assignment),mutateRefereeing(actors.comision,{...assignment,operationKey:randomUUID()})]);assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
  const winner=race.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<{id:string;version:number;operationKey:string}>;
  const receipt=winner.value;assert.deepEqual(await recoverRefereeOperation(actors.comision,receipt.operationKey),receipt);
  const command={...assignment,operationKey:receipt.operationKey};assert.deepEqual(await mutateRefereeing(actors.comision,command),receipt);
  await assert.rejects(mutateRefereeing(actors.comision,{...command,reason:"Contenido distinto con la misma clave"}));
  assert.equal(Number((await db.query("SELECT count(*) FROM sports_management.referee_assignments WHERE match_id=$1",[match])).rows[0].count),1);
  assert.equal(Number((await db.query("SELECT count(*) FROM sports_management.referee_operations WHERE assignment_id=$1",[receipt.id])).rows[0].count),3);
  checks.push("asignacion-directa-permisos-carrera-idempotencia-recuperacion");
  const simultaneous=await newMatch();assert.ok((await assess(simultaneous,ref)).blockers.some(b=>b.code==="OVERLAP"));
  const concurrentRef=await newRef(),left=await newMatch("2026-12-08T16:00Z","2026-12-08T18:00Z"),right=await newMatch("2026-12-08T17:00Z","2026-12-08T19:00Z");
  const collision=await Promise.allSettled([left,right].map(matchId=>mutateRefereeing(actors.comision,cmd("assign",{refereeId:concurrentRef,matchId,expectedMatchVersion:1}))));assert.equal(collision.filter(r=>r.status==="fulfilled").length,1);
  checks.push("traslape-dos-conexiones-distintos-partidos");
  const candidate=await newRef(),reviewMatch=await newMatch("2026-12-09T16:00Z","2026-12-09T18:00Z");
  const proposed=await mutateRefereeing(actors.programador,cmd("propose",{refereeId:candidate,matchId:reviewMatch,expectedMatchVersion:1}));
  await mutateRefereeing(actors.comision,cmd("register",{personId:(await db.query("SELECT person_id FROM sports_management.referees WHERE id=$1",[candidate])).rows[0].person_id,clubId:clubs[0],expectedVersion:await version(candidate),active:false}));
  await assert.rejects(mutateRefereeing(actors.comision,cmd("approve",{assignmentId:proposed.id,expectedVersion:proposed.version,expectedMatchVersion:1})));
  assert.equal((await db.query("SELECT status FROM sports_management.referee_assignments WHERE id=$1",[proposed.id])).rows[0].status,"PROPOSED");checks.push("revalidacion-al-aprobar");
  const lateClub=await scalar("INSERT INTO sports_management.clubs(league_id,name,reference_number) VALUES($1,'Club con ingreso posterior',$2) RETURNING id",[league,randomUUID()]);
  await db.query("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by) VALUES($1,$2,$3,$4,'Sintético','APPROVED',$5)",[season,lateClub,league,randomUUID(),actors.comision]);
  const lateRef=await newRef(true,true,lateClub),lateMatch=await newMatch('2026-12-09T20:00Z','2026-12-09T22:00Z');
  const lateProposal=await mutateRefereeing(actors.programador,cmd('propose',{refereeId:lateRef,matchId:lateMatch,expectedMatchVersion:1}));
  const lateTeam=await scalar("INSERT INTO sports_management.teams(club_id,name,reference_number) VALUES($1,'Tercero incorporado después',$2) RETURNING id",[lateClub,randomUUID()]);
  const lateEnrollment=await scalar("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,status) VALUES($1,$2,$3,$4,'REGISTERED') RETURNING id",[season,lateTeam,lateClub,sc]);
  await db.query("UPDATE sports_management.season_teams SET group_id=$2 WHERE id=$1",[lateEnrollment,group]);
  await assert.rejects(mutateRefereeing(actors.comision,cmd('approve',{assignmentId:lateProposal.id,expectedVersion:lateProposal.version,expectedMatchVersion:1})),e=>e instanceof Error&&'code'in e&&e.code==='CLUB_IN_GROUP');
  checks.push('club-del-grupo-revalidado-tras-propuesta');
  // Fallo posterior a la propuesta: PostgreSQL debe revertir también el historial interno.
  const rollbackRef=await newRef(),rollbackMatch=await newMatch("2026-12-10T16:00Z","2026-12-10T18:00Z");
  await db.query("CREATE FUNCTION public.pdgld143_fail_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='APPROVED' THEN RAISE EXCEPTION 'SYNTHETIC_INTERMEDIATE_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER zz_pdgld143_fail BEFORE UPDATE ON sports_management.referee_assignments FOR EACH ROW EXECUTE FUNCTION public.pdgld143_fail_approval()");
  try{await assert.rejects(mutateRefereeing(actors.comision,cmd("assign",{refereeId:rollbackRef,matchId:rollbackMatch,expectedMatchVersion:1})));assert.equal(Number((await db.query("SELECT count(*) FROM sports_management.referee_assignments WHERE match_id=$1",[rollbackMatch])).rows[0].count),0);assert.equal(Number((await db.query("SELECT count(*) FROM sports_management.referee_operations WHERE referee_id=$1 AND action IN ('propose','approve','assign')",[rollbackRef])).rows[0].count),0);}finally{await db.query("DROP TRIGGER zz_pdgld143_fail ON sports_management.referee_assignments; DROP FUNCTION public.pdgld143_fail_approval()");}
  checks.push("rollback-fallo-intermedio-sin-propuesta-parcial");
  await assert.rejects(prisma.$transaction(tx=>assertOwnRefereeAssignment(tx,actors.arbitro,match)));
  await assert.rejects(mutateRefereeing(actors.comision,cmd("revoke",{assignmentId:receipt.id,expectedVersion:99,expectedMatchVersion:1})));
  assert.equal((await db.query("SELECT status FROM sports_management.referee_assignments WHERE id=$1",[receipt.id])).rows[0].status,"APPROVED");
  checks.push("uuid-ajeno-y-version-obsoleta");
  console.log(JSON.stringify({suite:"PDGLD-143",postgres:c.version,checks,passed:true}));
  return {newMatch,newRef,cmd,checks};
}
