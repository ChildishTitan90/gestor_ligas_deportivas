import {runParticipationEligibilityTests} from "./player-participation-eligibility";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {TestContext} from "node:test";
import type {PrismaClient} from "@prisma/client";
import {INITIAL_PERMISSION_GRANTS} from "../../prisma/permissions-data";
import {AuthorizationError} from "../../src/server/auth/authorization";
import {registerPlayerForActor} from "../../src/features/players/server/service";
import {PlayerRegistrationError} from "../../src/features/players/server/access";
import {configurePlayerPathwayForActor,createCategoryParticipationForActor,readCategoryParticipationsForActor,CategoryParticipationError} from "../../src/features/players/server/category-participations";
import {readPlayerDossierForActor} from "../../src/features/players/server/document-queries";
import {Browser} from "./auth.test.mjs";
import argon2 from "argon2";
import {writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {tmpdir} from "node:os";

export async function runCategoryParticipationTests(t:TestContext,db:PrismaClient,actors:Record<string,string>,clubId:string,otherTeamId:string,makeCurp:(date:string,root?:string,differentiator?:string)=>string){
  assert.equal(process.env.AUTH_TEST_RUN,"1");assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/pdgld48_test_[a-f0-9]{16}$/);
  // Solo esta BD desechable: reloj compartido del nuevo servicio y su trigger.
  await db.$executeRaw`CREATE OR REPLACE FUNCTION sports_management.player_participation_now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT ''2026-10-26T12:00:00-06:00''::timestamptz'`;
  const curpChecks=await db.player_curp_checks.count(),nonce=randomUUID();
  const club=await db.clubs.findUniqueOrThrow({where:{id:clubId}});
  const sport=await db.sports.findUniqueOrThrow({where:{code:"SOCCER"}});
  const reason="Fixture explícito de participación superior, sin habilitación deportiva";
  const fixture=await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason',${reason},true)`;
    const adminRole=await tx.roles.findUniqueOrThrow({where:{code:"SUPERADMIN"}});
    for(const grant of INITIAL_PERMISSION_GRANTS.filter(g=>g.roleCode==="SUPERADMIN" && g.module==="competitions")){
      const permission=await tx.permissions.upsert({where:{module_action:{module:grant.module,action:grant.action}},update:{},create:{module:grant.module,action:grant.action}});
      await tx.role_permissions.upsert({where:{role_id_permission_id:{role_id:adminRole.id,permission_id:permission.id}},update:{context_only:false},create:{role_id:adminRole.id,permission_id:permission.id,context_only:false}});
    }
    const season=await tx.seasons.create({data:{league_id:club.league_id,sport_id:sport.id,name:`P13 participación ${nonce}`,start_date:new Date('2026-01-01'),end_date:new Date('2026-12-31')}});
    const rule=await tx.competition_rules.create({data:{season_id:season.id,version_number:1}});
    const affiliation=await tx.club_affiliations.create({data:{club_id:clubId,season_id:season.id,league_id:club.league_id,reference_number:`P13-${nonce}`,uniform_colors:"Azul sintético",requested_by:actors.delegate,status:"APPROVED"}});
    const teams=[];
    for(let index=0;index<4;index++){
      // Los nombres deliberadamente no indican el orden. Solo la configuración de familia lo define.
      const category=await tx.categories.create({data:{league_id:club.league_id,sport_id:sport.id,name:`Categoría ${nonce} ${index}`}});
      const policy={referenceYear:2026,minimumAge:index===3?35:18,maximumAge:null,exceptionMinimumAge:null,documents:["CURP","INE"],registrationDays:[1,2,3],timezone:"America/Mexico_City",playersOnField:11,maximumCalledUp:null,maximumRoster:null};
      const sc=await tx.season_categories.create({data:{season_id:season.id,category_id:category.id,competition_rule_id:rule.id,hierarchy_order:10-index,type:index===3?"VETERANS":"OPEN",minimum_age:policy.minimumAge,age_cutoff_date:new Date('2026-12-31'),eligibility_pending:false,player_policy:policy}});
      await tx.club_affiliation_categories.create({data:{affiliation_id:affiliation.id,season_id:season.id,category_id:category.id,authorized_by:actors.admin,authorized_at:new Date()}});
      const group=await tx.groups.create({data:{season_id:season.id,season_category_id:sc.id,name:`Grupo ${index}`}});
      const team=await tx.teams.create({data:{club_id:clubId,name:`Equipo sintético ${index}`,reference_number:`P13-team-${index}-${nonce}`}});
      const st=await tx.season_teams.create({data:{club_id:clubId,season_id:season.id,team_id:team.id,group_id:group.id}});
      teams.push({id:st.id,categoryId:sc.id});
    }
    return {season,rule,affiliation,teams};
  },{timeout:30000});
  const [base,upper,top,veterans]=fixture.teams;
  const config={pathwayCode:"FUERZAS_PRUEBA",expectedSeasonVersion:fixture.season.version,reason,categories:[{seasonCategoryId:base.categoryId,level:1},{seasonCategoryId:upper.categoryId,level:2},{seasonCategoryId:top.categoryId,level:3}]};
  const input=(target:string,date:string,firstName="Rogelio")=>({seasonTeamId:target,identity:{curp:makeCurp(date),birthDate:date,firstName,paternalSurname:"Sierra",maternalSurname:"Lara"}});
  const request=(target:string)=>({operationKey:randomUUID(),targetSeasonTeamId:target,reason});
  const isCode=(code:string)=>(error:unknown)=>error instanceof CategoryParticipationError && error.code===code;
  let originId="";

  await t.test("P13 sesión: reutiliza Persona de un presidente del club sin duplicar identidad, cuenta ni solicitud",async()=>{
    const body=input(base.id,'1951-04-01');
    const person=await db.people.create({data:{curp:body.identity.curp,birth_date:new Date(body.identity.birthDate),first_name:body.identity.firstName,paternal_surname:"Sierra",maternal_surname:"Lara"}});
    await db.users.create({data:{person_id:person.id,username:`presidente-${nonce}`,email:`presidente-${nonce}@example.test`,password_hash:"synthetic-no-login",must_change_password:false}});
    await db.club_officers.create({data:{affiliation_id:fixture.affiliation.id,person_id:person.id,office:"PRESIDENT",starts_at:new Date('2026-01-01')}});
    const before={people:await db.people.count(),users:await db.users.count()};
    await assert.rejects(registerPlayerForActor(actors.other,body),e=>e instanceof AuthorizationError);
    const results=await Promise.all([registerPlayerForActor(actors.delegate,body),registerPlayerForActor(actors.delegate,body)]);
    assert.equal(results[0].personId,person.id);assert.equal(results[0].registrationId,results[1].registrationId);originId=results[0].registrationId;
    assert.equal(await db.people.count(),before.people);assert.equal(await db.users.count(),before.users);
    assert.equal(await db.player_registrations.count({where:{person_id:person.id,season_id:fixture.season.id}}),1);
    await assert.rejects(registerPlayerForActor(actors.delegate,{...body,identity:{...body.identity,firstName:"Nombre diferente"}}),e=>e instanceof PlayerRegistrationError && e.code==="IDENTITY_UNAVAILABLE");
    await assert.rejects(db.people.create({data:{curp:body.identity.curp,first_name:"Otra persona",paternal_surname:"Prueba"}}));
  });
  await t.test("P13 sesión: familia explícita con permisos, versiones y tipos compatibles; sin orden por nombre",async()=>{
    await assert.rejects(configurePlayerPathwayForActor(actors.delegate,fixture.season.id,config),e=>e instanceof AuthorizationError);
    await assert.rejects(configurePlayerPathwayForActor(actors.admin,fixture.season.id,{...config,pathwayCode:"MIXTA",categories:[config.categories[0],{seasonCategoryId:veterans.categoryId,level:2}]}),isCode("INCOMPATIBLE_CATEGORIES"));
    await assert.rejects(configurePlayerPathwayForActor(actors.admin,fixture.season.id,{...config,expectedSeasonVersion:999}),isCode("STALE_VERSION"));
    assert.equal((await configurePlayerPathwayForActor(actors.admin,fixture.season.id,config)).replayed,false);
    assert.equal((await configurePlayerPathwayForActor(actors.admin,fixture.season.id,config)).replayed,true);
    const levelIds=(await db.player_category_levels.findMany({where:{season_id:fixture.season.id},select:{id:true}})).map(l=>l.id);
    assert.equal(await db.audit_logs.count({where:{table_name:"player_category_levels",entity_id:{in:levelIds},action:"INSERT"}}),3,"Configuración auditada una vez por categoría con identificador de entidad");
    await assert.rejects(configurePlayerPathwayForActor(actors.admin,fixture.season.id,{...config,categories:[config.categories[1],config.categories[0],config.categories[2]].map((c,i)=>({...c,level:i+1}))}),isCode("PATHWAY_ALREADY_CONFIGURED"));
  });
  await t.test("P13 sesión: superior consecutiva, reenvíos y carreras conservan origen e impiden otra inscripción",async()=>{
    const body=request(upper.id),before=await db.player_registrations.findUniqueOrThrow({where:{id:originId}});
    await assert.rejects(createCategoryParticipationForActor(actors.other,originId,body),e=>e instanceof AuthorizationError);
    await assert.rejects(createCategoryParticipationForActor(actors.admin,originId,request(otherTeamId)),isCode("INCOMPATIBLE_CONTEXT"));
    await assert.rejects(createCategoryParticipationForActor(actors.delegate,originId,request(top.id)),isCode("SUPERIOR_CATEGORY_REQUIRED"));
    await assert.rejects(createCategoryParticipationForActor(actors.delegate,originId,request(base.id)),isCode("SUPERIOR_CATEGORY_REQUIRED"));
    const results=await Promise.all([createCategoryParticipationForActor(actors.delegate,originId,body),createCategoryParticipationForActor(actors.delegate,originId,{...body,operationKey:randomUUID()})]);
    assert.equal(results[0].id,results[1].id);assert.equal(results[0].sportsEligible,false);assert.equal(results[0].status,"PENDING_ELIGIBILITY");
    assert.deepEqual(await db.player_registrations.findUniqueOrThrow({where:{id:originId}}),before);
    assert.equal(await db.player_registrations.count({where:{person_id:before.person_id,season_id:fixture.season.id}}),1);
    assert.equal(await db.player_category_participations.count({where:{origin_registration_id:originId}}),1);
    assert.equal(await db.audit_logs.count({where:{table_name:"player_category_participations",entity_id:results[0].id,action:"INSERT"}}),1);
    await assert.rejects(createCategoryParticipationForActor(actors.delegate,originId,{...body,targetSeasonTeamId:top.id}),isCode("PARTICIPATION_CONFLICT"));
    await assert.rejects(registerPlayerForActor(actors.delegate,input(upper.id,'1951-04-01')),e=>e instanceof PlayerRegistrationError && e.code==="REGISTRATION_CONFLICT");
    assert.equal((await readCategoryParticipationsForActor(actors.delegate,originId)).length,1);
    await assert.rejects(readCategoryParticipationsForActor(actors.other,originId),e=>e instanceof AuthorizationError);
    assert.equal((await readPlayerDossierForActor(actors.delegate,originId)).dossierComplete,false,"Una participación no satisface documentos de origen ni del destino");
    const stored=await db.player_category_participations.findUniqueOrThrow({where:{id:results[0].id}});
    await assert.rejects(db.player_category_participations.create({data:{...stored,id:randomUUID(),request_key:randomUUID()}}),e=>(e as {code?:string}).code==="P2002");
    await assert.rejects(db.player_category_participations.update({where:{id:stored.id},data:{status:"ACTIVE"}}),/PLAYER_PARTICIPATION_IMMUTABLE/);
  });
  await t.test("P13 sesión: inferior, familia distinta, edad y configuración pendiente se rechazan",async()=>{
    const second=await registerPlayerForActor(actors.delegate,input(upper.id,'1951-04-11',"Patricio"));
    await assert.rejects(createCategoryParticipationForActor(actors.delegate,second.registrationId,request(base.id)),isCode("SUPERIOR_CATEGORY_REQUIRED"));
    await assert.rejects(createCategoryParticipationForActor(actors.delegate,second.registrationId,request(veterans.id)),isCode("PATHWAY_NOT_CONFIGURED"));
    const original=await db.season_categories.findUniqueOrThrow({where:{id:top.categoryId}});
    await db.season_categories.update({where:{id:top.categoryId},data:{eligibility_pending:true}});
    await assert.rejects(createCategoryParticipationForActor(actors.delegate,second.registrationId,request(top.id)),isCode("PLAYER_POLICY_PENDING"));
    const policy=original.player_policy as Record<string,unknown>;
    await db.season_categories.update({where:{id:top.categoryId},data:{eligibility_pending:false,minimum_age:100,player_policy:{...policy,minimumAge:100}}});
    await assert.rejects(createCategoryParticipationForActor(actors.delegate,second.registrationId,request(top.id)),isCode("AGE_REQUIRES_REVIEW"));
    await db.season_categories.update({where:{id:top.categoryId},data:{minimum_age:original.minimum_age,player_policy:original.player_policy!}});
    await assert.rejects(db.season_categories.update({where:{id:base.categoryId},data:{type:"VETERANS"}}));
    await assert.rejects(db.player_category_participations.create({data:{origin_registration_id:second.registrationId,season_id:fixture.season.id,club_id:clubId,target_season_team_id:base.id,target_season_category_id:base.categoryId,requested_by:actors.delegate,request_key:randomUUID(),request_hash:'0'.repeat(64)}}),/PLAYER_PARTICIPATION_CONTEXT/);
    await db.$executeRaw`CREATE OR REPLACE FUNCTION sports_management.player_participation_now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT ''2026-10-31T12:00:00-06:00''::timestamptz'`;
    try{await assert.rejects(createCategoryParticipationForActor(actors.delegate,second.registrationId,request(top.id)),isCode("REGISTRATION_WINDOW_CLOSED"));}
    finally{await db.$executeRaw`CREATE OR REPLACE FUNCTION sports_management.player_participation_now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT ''2026-10-26T12:00:00-06:00''::timestamptz'`;}
    const type=await db.sanction_types.findUniqueOrThrow({where:{code:"TIME"}});
    const article=await db.regulation_articles.create({data:{competition_rule_id:fixture.rule.id,number:"P13",description:reason,sanction_type_id:type.id}});
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason',${reason},true)`;
      const disciplinaryCase=await tx.disciplinary_cases.create({data:{season_id:fixture.season.id,reference_number:`CASE-${nonce}`,opened_by:actors.admin,description:reason}});
      const ruling=await tx.disciplinary_rulings.create({data:{case_id:disciplinaryCase.id,version_number:1,decided_by:actors.admin,decision:"Sanción sintética",reason}});
      await tx.sanctions.create({data:{ruling_id:ruling.id,article_id:article.id,sanction_type_id:type.id,registration_id:second.registrationId,starts_at:new Date('2026-01-01'),ends_at:new Date('2027-01-01'),blocks_participation:true}});
    });
    await assert.rejects(createCategoryParticipationForActor(actors.delegate,second.registrationId,request(top.id)),isCode("PARTICIPATION_BLOCKED"));
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason',${reason},true)`;
      await tx.player_registrations.update({where:{id:second.registrationId},data:{status:"WITHDRAWN",withdrawn_at:new Date()}});
    });
    await assert.rejects(registerPlayerForActor(actors.delegate,input(base.id,'1951-04-11',"Patricio")),e=>e instanceof PlayerRegistrationError && e.code==="REGISTRATION_CONFLICT","Una baja no habilita una nueva inscripción inferior");
    assert.equal(await db.player_registrations.count({where:{person_id:second.personId,season_id:fixture.season.id}}),1);
  });
  assert.equal(await db.player_curp_checks.count(),curpChecks,"Ninguna participación consulta al proveedor de CURP");
  if(process.env.PLAYER_PARTICIPATIONS_HTTP_BASE_URL)await t.test("P13 sesión HTTP: sesión, origen, alcance, configuración, participación y acuse idempotente",async()=>{
    const url=new URL(process.env.PLAYER_PARTICIPATIONS_HTTP_BASE_URL!);
    assert.equal(url.protocol,"http:");assert.equal(url.hostname,"127.0.0.1");assert.equal(process.env.AUTH_TEST_RUN,"1");
    assert.equal(process.env.VMX_API_KEY,"");
    const password=`Synthetic-${randomUUID()}!`,hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
    const browsers:Record<string,Browser>={};
    for(const code of ["delegate","admin","other"]){
      const actor=await db.users.update({where:{id:actors[code]},data:{password_hash:hash},select:{email:true}});
      const browser=new Browser(url.origin);await browser.login(actor.email,password);
      assert.equal((await browser.session()).user?.id,actors[code]);browsers[code]=browser;
    }
    const path=`/api/player-registrations/${originId}/category-participations`,configurationPath=`/api/competitions/seasons/${fixture.season.id}/player-pathways`;
    assert.equal((await new Browser(url.origin).request(path)).status,401);
    assert.equal((await browsers.other.request(path)).status,403);
    const post=async(browser:Browser,path:string,body:unknown,origin=url.origin)=>browser.request(path,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
    assert.equal((await post(browsers.delegate,configurationPath,config)).status,403);
    assert.equal((await post(browsers.admin,configurationPath,config)).status,200);
    assert.equal((await browsers.admin.request(configurationPath)).status,200);
    assert.equal((await post(browsers.delegate,path,request(upper.id),"https://other.example.test")).status,403);
    assert.equal((await post(browsers.delegate,path,{...request(upper.id),sportsEligible:true})).status,400);
    const response=await post(browsers.delegate,path,request(upper.id));assert.equal(response.status,200);
    const receipt=await response.json();assert.equal(receipt.replayed,true);assert.equal(receipt.sportsEligible,false);
    const list=await browsers.delegate.request(path);assert.equal(list.status,200);const rows=await list.json();assert.equal(rows.length,1);
    assert.equal('request_hash' in rows[0],false);assert.equal('curp' in rows[0],false);
    assert.equal(await db.player_curp_checks.count(),curpChecks);
    const reviewPath='/api/player-participations/'+rows[0].id+'/review',approvalPath='/api/player-registrations/'+originId+'/approval';
    const assessment=await readCategoryParticipationsForActor(actors.admin,originId);
    const review={operationKey:randomUUID(),expectedVersion:rows[0].version,fingerprint:assessment[0].assessment!.fingerprint,decision:'AUTHORIZE',reason};
    assert.equal((await post(new Browser(url.origin),reviewPath,review)).status,401);
    assert.equal((await post(browsers.delegate,reviewPath,review)).status,403);
    assert.equal((await post(browsers.admin,reviewPath,review)).status,409,'La ruta no omite los pendientes documentales');
    assert.equal((await post(browsers.admin,approvalPath,{operationKey:randomUUID(),fingerprint:review.fingerprint,reason},'https://other.example.test')).status,403);
    assert.equal((await browsers.admin.request(reviewPath,{method:'POST',headers:{origin:url.origin,'content-type':'application/json','X-Expected-Actor-Id':actors.delegate},body:JSON.stringify(review)})).status,403);
    const pages=['/access','/players/participations','/competitions/seasons/'+fixture.season.id+'/player-pathways','/competitions/seasons/'+fixture.season.id+'/categories/'+base.categoryId+'/documents'];
    for(const page of pages){const response=await browsers.admin.request(page);assert.equal(response.status,200);const html=await response.text();assert.equal(html.includes('NAVIGATION_UNAVAILABLE'),false);assert.equal(html.includes('No pudimos cargar el espacio de gestión'),false);}
    for(let attempt=0;attempt<2;attempt++){const responses=await Promise.all(pages.map(p=>browsers.admin.request(p)));for(const response of responses){assert.equal(response.status,200);assert.equal((await response.text()).includes('No pudimos cargar el espacio de gestión'),false,'Navegación concurrente disponible');}}
    if(process.env.PLAYER_PARTICIPATIONS_MANIFEST){
      const path=resolve(process.env.PLAYER_PARTICIPATIONS_MANIFEST);
      assert.equal(dirname(path),resolve(tmpdir()));
      const fresh=await registerPlayerForActor(actors.delegate,input(base.id,'1951-06-01',"Manuel"));
      const accounts=await db.users.findMany({where:{id:{in:[actors.delegate,actors.admin]}},select:{id:true,email:true}});
      await writeFile(path,JSON.stringify({baseUrl:url.origin,seasonId:fixture.season.id,originRegistrationId:fresh.registrationId,targetSeasonTeamId:upper.id,skipSeasonTeamId:top.id,originSeasonTeamId:base.id,pathway:config,accounts:accounts.map(a=>({...a,password,kind:a.id===actors.admin?'admin':'delegate'}))},null,2),{mode:0o600,flag:'wx'});
    }
  });
  await runParticipationEligibilityTests(t,db,actors,originId,base.categoryId,upper.categoryId);
}
