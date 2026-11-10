import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {getPrisma} from '../../src/server/db/prisma';
import {AuthorizationError} from '../../src/server/auth/authorization';
import {requestIdentityCorrectionForActor as request,decideIdentityCorrectionForActor as decide,IdentityCorrectionError,type CorrectionEvidence} from '../../src/features/players/server/identity-correction';
import {readHistoricalRegistrationFacts} from '../../src/features/players/server/season-identity-history';
import {readRegistrationLabels} from '../../src/features/players/server/registration-labels';
import {readPlayerCurpStatusForActor} from '../../src/features/players/server/curp-verification-service';
import {readPlayerIneStatusForActor} from '../../src/features/players/server/ine-verification-service';
import {readPlayerParticipationWorkspaceForActor} from '../../src/features/players/server/participation-workspace-queries';
import {syntheticPlayerPolicy} from '../fixtures/player-document-policy';

type Context={seasonId:string;stId:string;clubId:string;leagueId:string;sportId:string;higherTeamId:string;higherCategoryId:string};
export async function verifyMixedSeasonHistory({admin,delegate,foreign,context,curp,evidence}:{admin:string;delegate:string;foreign:string;context:Context;curp:(date:string,root?:string)=>string;evidence:CorrectionEvidence[]}){
 const db=getPrisma(),checks:string[]=[];
 const actor=async(tx:Parameters<Parameters<typeof db.$transaction>[0]>[0])=>tx.$queryRaw`SELECT set_config('app.user_id',${admin},true),set_config('app.reason','PDGLD-117 fixture mixto sintético',true)`;
 const makeSeason=async(year:number)=>db.$transaction(async tx=>{
  await actor(tx);const season=await tx.seasons.create({data:{league_id:context.leagueId,sport_id:context.sportId,name:'Historia '+randomUUID(),start_date:new Date(`${year}-01-01`),end_date:new Date(`${year}-12-31`)}});
  const rule=await tx.competition_rules.create({data:{season_id:season.id,version_number:1}});
  const affiliation=await tx.club_affiliations.create({data:{season_id:season.id,club_id:context.clubId,league_id:context.leagueId,status:'APPROVED',uniform_colors:'Azul',reference_number:randomUUID(),requested_by:admin}});
  const teams=[];for(const level of [1,2]){const cat=await tx.categories.create({data:{league_id:context.leagueId,sport_id:context.sportId,name:'Historia '+randomUUID()}});
   const sc=await tx.season_categories.create({data:{season_id:season.id,category_id:cat.id,competition_rule_id:rule.id,hierarchy_order:level,type:'OPEN',minimum_age:0,age_cutoff_date:new Date(`${year}-12-31`),eligibility_pending:false,player_policy:{...syntheticPlayerPolicy(),referenceYear:year}}});
   await tx.club_affiliation_categories.create({data:{affiliation_id:affiliation.id,season_id:season.id,category_id:cat.id,authorized_by:admin,authorized_at:new Date()}});
   const group=await tx.groups.create({data:{season_id:season.id,season_category_id:sc.id,name:'General'}}),team=await tx.teams.create({data:{club_id:context.clubId,name:'Histórico',reference_number:randomUUID()}});
   const st=await tx.season_teams.create({data:{season_id:season.id,club_id:context.clubId,team_id:team.id,group_id:group.id}});
   await tx.player_category_levels.create({data:{season_category_id:sc.id,season_id:season.id,pathway_code:'HISTORY',level,configured_by:admin}});teams.push({st,sc,group});}
  return {season,rule,teams};
 },{timeout:30000});
 const old=await makeSeason(2025),legacy=await makeSeason(2024);
 const person=await db.people.create({data:{first_name:'Persona mixta',paternal_surname:'Sintética',maternal_surname:null,birth_date:new Date('1993-07-09'),curp:curp('1993-07-09','MIAA')}});
 const register=async(seasonId:string,stId:string)=>db.$transaction(async tx=>{await actor(tx);return tx.player_registrations.create({data:{person_id:person.id,season_id:seasonId,season_team_id:stId,reference_number:randomUUID(),status:'ACTIVE',identity_review_status:'NOT_REQUIRED'}});});
 const open=await register(context.seasonId,context.stId),closed=await register(old.season.id,old.teams[0].st.id),unavailable=await register(legacy.season.id,legacy.teams[0].st.id);
 const participation=async(regId:string,seasonId:string,teamId:string,catId:string)=>db.$transaction(async tx=>{await actor(tx);const p=await tx.player_category_participations.create({data:{origin_registration_id:regId,season_id:seasonId,club_id:context.clubId,target_season_team_id:teamId,target_season_category_id:catId,requested_by:delegate,request_key:randomUUID(),request_hash:'a'.repeat(64)}});const event=await tx.audit_logs.create({data:{user_id:admin,action:'PLAYER_PARTICIPATION_REVIEWED',table_name:'player_category_participations',entity_id:p.id,reason:'Acuse sintético mixto',previous_data:{status:p.status,version:1},new_data:{status:'AUTHORIZED',version:2,fingerprint:'a'.repeat(64)}}});return tx.player_category_participations.update({where:{id:p.id},data:{status:'AUTHORIZED',version:2,eligibility_fingerprint:'a'.repeat(64),review_event_id:event.id}});});
 const openPart=await participation(open.id,context.seasonId,context.higherTeamId,context.higherCategoryId),oldPart=await participation(closed.id,old.season.id,old.teams[1].st.id,old.teams[1].sc.id);
 // Datos no vacíos: resultado administrativo y sanción histórica por referencia.
 await db.$transaction(async tx=>{await actor(tx);const day=await tx.matchdays.create({data:{season_id:old.season.id,number:1,start_date:new Date('2025-03-01'),end_date:new Date('2025-03-01')}});
  const rival=await tx.teams.create({data:{club_id:context.clubId,name:'Rival histórico',reference_number:randomUUID()}});
  const rivalEnrollment=await tx.season_teams.create({data:{season_id:old.season.id,club_id:context.clubId,team_id:rival.id,group_id:old.teams[0].group.id}});
  const resolvedStatus=await tx.match_statuses.findUniqueOrThrow({where:{code:'ADMINISTRATIVELY_RESOLVED'}});
  const match=await tx.matches.create({data:{season_id:old.season.id,group_id:old.teams[0].group.id,status_id:resolvedStatus.id,matchday_id:day.id,number:randomUUID(),home_team_id:old.teams[0].st.id,away_team_id:rivalEnrollment.id}});
  await tx.match_results.create({data:{match_id:match.id,home_score:2,away_score:1,source:'ADMINISTRATIVE',validated_by:admin,reason:'Resultado sintético previo al cierre'}});
  const type=await tx.sanction_types.findUniqueOrThrow({where:{code:'TIME'}});
  const article=await tx.regulation_articles.create({data:{competition_rule_id:old.rule.id,number:'SYN-117',description:'Artículo sintético',sanction_type_id:type.id}});
  const c=await tx.disciplinary_cases.create({data:{season_id:old.season.id,reference_number:randomUUID(),description:'Incidencia sintética histórica',opened_by:admin}});
  const ruling=await tx.disciplinary_rulings.create({data:{case_id:c.id,version_number:1,decided_by:admin,decision:'Decisión sintética',reason:'Historial que debe conservarse'}});
  await tx.sanctions.create({data:{ruling_id:ruling.id,article_id:article.id,sanction_type_id:type.id,registration_id:closed.id,starts_at:new Date('2025-03-01'),ends_at:new Date('2025-04-01'),blocks_participation:true}});
 });
 const close=async(id:string,withoutCapture=false)=>db.$transaction(async tx=>{await actor(tx);if(withoutCapture)await tx.$executeRawUnsafe('ALTER TABLE sports_management.seasons DISABLE TRIGGER capture_season_identity_history');await tx.seasons.update({where:{id},data:{status:'ACTIVE'}});await tx.seasons.update({where:{id},data:{status:'CLOSED',closed_at:new Date(),version:{increment:1}}});if(withoutCapture)await tx.$executeRawUnsafe('ALTER TABLE sports_management.seasons ENABLE TRIGGER capture_season_identity_history');});
 await close(old.season.id);await close(legacy.season.id,true);
 const history=()=>db.$transaction(async tx=>({old:await tx.player_registrations.findUnique({where:{id:closed.id}}),legacy:await tx.player_registrations.findUnique({where:{id:unavailable.id}}),part:await tx.player_category_participations.findUnique({where:{id:oldPart.id}}),facts:await tx.season_registration_history.findMany({where:{person_id:person.id},orderBy:{registration_id:'asc'}}),results:await tx.match_results.findMany({where:{matches:{season_id:old.season.id}},orderBy:{id:'asc'}}),sanctions:await tx.sanctions.findMany({where:{registration_id:closed.id},orderBy:{id:'asc'}})}));
 const before=await history();assert.equal(before.results.length,1);assert.equal(before.sanctions.length,1);
 const decision=()=>({operationKey:randomUUID(),decision:'APPLY',observations:'Evidencia sintética revisada',evidenceChecked:true,samePersonChecked:true,curpDiscrepancy:false});
 const propose=async(date:string)=>{const p=await db.people.findUniqueOrThrow({where:{id:person.id}});return request(delegate,open.id,{operationKey:randomUUID(),expectedIdentityVersion:p.identity_version,identity:{firstName:p.first_name,paternalSurname:p.paternal_surname,maternalSurname:p.maternal_surname,birthDate:date,curp:curp(date,'MIAA')},reason:'Nacimiento rectificado con evidencia sintética',identityDoubt:false},evidence);};
 const req=await propose('1992-07-08');await assert.rejects(decide(foreign,open.id,req.id,decision()),e=>e instanceof AuthorizationError);await decide(admin,open.id,req.id,decision());
 assert.deepEqual(await history(),before);const current=await db.people.findUniqueOrThrow({where:{id:person.id}});assert.equal(current.id,person.id);assert.equal(current.identity_version,2);assert.equal(current.birth_date!.toISOString().slice(0,10),'1992-07-08');assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:open.id}})).status,'INELIGIBLE');assert.equal((await db.player_category_participations.findUniqueOrThrow({where:{id:openPart.id}})).status,'WITHDRAWN');
 const reassessed=await db.audit_logs.findMany({where:{action:'PLAYER_CORRECTION_REASSESSED',entity_id:{in:[open.id,closed.id,unavailable.id]}}});assert.deepEqual(reassessed.map(x=>x.entity_id),[open.id]);
 assert.equal((await db.$transaction(tx=>readRegistrationLabels(tx,unavailable.id))).name,'Información histórica no disponible');
 assert.deepEqual(await db.$transaction(tx=>readHistoricalRegistrationFacts(tx,unavailable.id)),{status:'UNAVAILABLE'});
 const facts=await db.$transaction(tx=>readHistoricalRegistrationFacts(tx,closed.id));assert.equal(facts.status,'CAPTURED');if(facts.status==='CAPTURED'){assert.equal(facts.birthDate,'1993-07-09');assert.equal(facts.identityVersion,1);}
 for(const read of [readPlayerCurpStatusForActor,readPlayerIneStatusForActor])await assert.rejects(read(admin,closed.id),e=>e instanceof Error&&'code'in e&&e.code==='HISTORICAL_VERIFICATION_UNAVAILABLE');
 const workspace=await readPlayerParticipationWorkspaceForActor(admin,closed.id);assert(workspace.participations.every(p=>p.historical&&p.sportsEligible===null&&!p.canReview));
 checks.push('mixed-birth-only-open-reassessed','closed-results-sanctions-and-participations-byte-equivalent','legacy-missing-facts-never-use-current-identity','closed-verification-readers-fail-specifically');
 // Fallo tras invalidaciones debe revertir persona, solicitud, estado y auditoría.
 const rollback=await propose('1991-07-07'),prePerson=await db.people.findUniqueOrThrow({where:{id:person.id}}),preOpen=await db.player_registrations.findUniqueOrThrow({where:{id:open.id}});
 await db.$executeRawUnsafe("CREATE FUNCTION public.pdgld117_mixed_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PLAYER_CORRECTION_APPLIED' THEN RAISE EXCEPTION 'SYNTHETIC_MIXED_ROLLBACK'; END IF; RETURN NEW; END $$");await db.$executeRawUnsafe('CREATE TRIGGER pdgld117_mixed_fail BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION public.pdgld117_mixed_fail()');
 try{await assert.rejects(decide(admin,open.id,rollback.id,decision()));}finally{await db.$executeRawUnsafe('DROP TRIGGER pdgld117_mixed_fail ON sports_management.audit_logs');await db.$executeRawUnsafe('DROP FUNCTION public.pdgld117_mixed_fail()');}
 assert.deepEqual(await db.people.findUniqueOrThrow({where:{id:person.id}}),prePerson);assert.deepEqual(await db.player_registrations.findUniqueOrThrow({where:{id:open.id}}),preOpen);assert.deepEqual(await history(),before);assert.equal((await db.player_identity_corrections.findUniqueOrThrow({where:{id:rollback.id}})).status,'PENDING');checks.push('mixed-full-rollback');
 const duplicate=await db.people.create({data:{first_name:'Otra persona',paternal_surname:'Sintética',birth_date:new Date('1988-06-04'),curp:curp('1988-06-04','DUPA')}});
 const collision=await request(delegate,open.id,{operationKey:randomUUID(),expectedIdentityVersion:prePerson.identity_version,identity:{firstName:prePerson.first_name,paternalSurname:prePerson.paternal_surname,maternalSurname:prePerson.maternal_surname,birthDate:'1988-06-04',curp:duplicate.curp!},reason:'Colisión sintética de CURP',identityDoubt:false},evidence);
 await assert.rejects(decide(admin,open.id,collision.id,decision()),e=>e instanceof IdentityCorrectionError&&e.code==='DUPLICATE_CURP');assert.deepEqual(await history(),before);assert.deepEqual(await db.people.findUniqueOrThrow({where:{id:person.id}}),prePerson);checks.push('mixed-duplicate-curp-preserves-all-facts');
 // Carreras con dos conexiones: comprobar espera real sobre la llave compartida.
 const url=process.env.DATABASE_URL!;const blocker=new pg.Client({connectionString:url}),closer=new pg.Client({connectionString:url});await blocker.connect();await closer.connect();
 const wait=async(fn:()=>Promise<boolean>)=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('MIXED_RACE_NOT_OVERLAPPED');};
 const waiting=async()=>Number((await closer.query("SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND classid=117 AND objid=20261108 AND NOT granted")).rows[0].n)>0;
 try{
  const race=await makeSeason(2023);const raceReg=await register(race.season.id,race.teams[0].st.id);await db.$transaction(async tx=>{await actor(tx);await tx.seasons.update({where:{id:race.season.id},data:{status:'ACTIVE'}});});const r=await propose('1990-07-06');
  await blocker.query('BEGIN');await blocker.query("SELECT set_config('app.user_id',$1,true),set_config('app.reason','Cierre concurrente sintético',true)",[admin]);await blocker.query('SELECT pg_advisory_xact_lock(117,20261108)');await blocker.query("UPDATE sports_management.seasons SET status='CLOSED',closed_at=clock_timestamp(),version=version+1 WHERE id=$1",[race.season.id]);const applying=decide(admin,open.id,r.id,decision());await wait(waiting);await blocker.query('COMMIT');await applying;
  const h=await db.$transaction(tx=>readHistoricalRegistrationFacts(tx,raceReg.id));assert.equal(h.status,'CAPTURED');if(h.status==='CAPTURED')assert.equal(h.birthDate,'1992-07-08');assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:raceReg.id}})).status,'ACTIVE');
  const second=await makeSeason(2022);const secondReg=await register(second.season.id,second.teams[0].st.id);await db.$transaction(async tx=>{await actor(tx);await tx.seasons.update({where:{id:second.season.id},data:{status:'ACTIVE'}});});const r2=await propose('1989-07-05');
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM sports_management.people WHERE id=$1 FOR UPDATE',[person.id]);const applyFirst=decide(admin,open.id,r2.id,decision());await wait(async()=>Number((await closer.query("SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND classid=117 AND objid=20261108 AND granted")).rows[0].n)>0);
  await closer.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','Cierre posterior a corrección sintética',false)",[admin]);const closing=closer.query("UPDATE sports_management.seasons SET status='CLOSED',closed_at=clock_timestamp(),version=version+1 WHERE id=$1",[second.season.id]);
  await wait(async()=>Number((await blocker.query("SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND classid=117 AND objid=20261108 AND NOT granted")).rows[0].n)>0);await blocker.query('COMMIT');await applyFirst;await closing;
  const h2=await db.$transaction(tx=>readHistoricalRegistrationFacts(tx,secondReg.id));assert.equal(h2.status,'CAPTURED');if(h2.status==='CAPTURED')assert.equal(h2.birthDate,'1989-07-05');checks.push('closure-wins-captures-before-and-correction-skips-closed','correction-wins-closure-captures-new-version');
 }finally{await blocker.query('ROLLBACK').catch(()=>{});await blocker.end();await closer.end();}
 assert.deepEqual((await history()).results,before.results);assert.deepEqual((await history()).sanctions,before.sanctions);
 await assert.rejects(db.people.update({where:{id:person.id},data:{first_name:'SQL sin trámite'}}));checks.push('direct-sql-cannot-bypass-mixed-correction');
 return checks;
}
