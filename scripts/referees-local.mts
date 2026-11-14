import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import * as argon2 from "argon2";
import {PrismaClient} from "@prisma/client";
import {SerialPrismaPg} from "../src/server/db/transaction-queue";
import {installPermissionCatalog,installLeagueCreationPermission} from "../prisma/seed-permissions";
import { INITIAL_PERMISSION_GRANTS } from "../prisma/permissions-data";
import { provisionPreviewRuntime, PREVIEW_MARKER } from "./preview/runtime-plan.mjs";
import assert from "node:assert/strict";

// Herramienta manual de revisión, sin conexión heredada ni volúmenes. --serve
// deja la aplicación disponible hasta Ctrl+C; el contenedor pertenece al proceso.
const nonce = randomBytes(8).toString("hex"), container = `pdgld141-${nonce}`, database = `pdgld48_test_${nonce}`;
const docker = (args: string[]) => execFileSync("docker", args, { encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","pipe"] }).trim();
let created = false; let app: ReturnType<typeof spawn>|undefined; let db: pg.Client|undefined;
const serve = process.argv.includes("--serve");
const version=process.argv.find(a=>a.startsWith("--postgres="))?.split("=")[1]??"15";
if(!["15","17"].includes(version))throw Error("INVALID_POSTGRES_VERSION");
try {
  docker(["run","-d","--name",container,"--label","pdgld.ticket=PDGLD-141","-e","POSTGRES_HOST_AUTH_METHOD=trust","-e",`POSTGRES_DB=${database}`,"-p","127.0.0.1::5432",`postgres:${version}`]); created=true;
  const port=docker(["port",container,"5432/tcp"]).split(":").at(-1)!;
  const adminUrl=`postgresql://postgres:synthetic-local-only@127.0.0.1:${port}/${database}`;
  const runtimePassword=randomBytes(24).toString("hex");
  const runtimeUrl=`postgresql://gestor_ligas_preview:${runtimePassword}@127.0.0.1:${port}/${database}`;
  const env={NODE_ENV:"development" as const,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,
    DATABASE_URL:adminUrl,DIRECT_URL:adminUrl,NEXTAUTH_URL:"http://127.0.0.1:3193",NEXTAUTH_SECRET:randomBytes(48).toString("hex"),AUTH_TEST_RUN:"1",
    VMX_API_KEY:"",ACCOUNT_EMAIL_ENABLED:"false",RESEND_API_KEY:"",SUPABASE_URL:"https://storage.example.test",SUPABASE_STORAGE_SERVER_KEY:"synthetic-only"};
  for(let n=0;;n++){try{docker(["exec",container,"pg_isready","-U","postgres"]);break;}catch{if(n===60)throw Error("LOCAL_DATABASE_NOT_READY");await new Promise(r=>setTimeout(r,250));}}
  const migrate=spawnSync(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{env,encoding:"utf8",windowsHide:true});
  if(migrate.status!==0)throw Error(`LOCAL_MIGRATION_FAILED ${migrate.stderr?.replaceAll(adminUrl,"[local]")}`);
  db=new pg.Client({connectionString:adminUrl});await db.connect();
  if(process.argv.includes("--acceptance")){
    const {verifyProductionSecurity,verifyEnrollmentProductionSecurity}=await import("./ci/verify-production-security.mjs");
    await verifyProductionSecurity(db);await verifyEnrollmentProductionSecurity(db);
    const {verifyRefereeingProductionPlan}=await import("../tests/integration/refereeing-production-plan.mjs");
    await verifyRefereeingProductionPlan(db,adminUrl,database);
    const diff=spawnSync(process.execPath,["node_modules/prisma/build/index.js","migrate","diff","--from-config-datasource","--to-schema","prisma/schema.prisma","--exit-code"],{env,encoding:"utf8",windowsHide:true});
    assert.equal(diff.status,0,"MIGRATION_SCHEMA_DRIFT");
  }
  const scalar=async(sql:string,values:unknown[]=[]) => (await db!.query(sql,values)).rows[0].id as string;
  const hash=await argon2.hash("Arbitraje-Local-141!",{type:argon2.argon2id});
  const actors:Record<string,string>={},people:Record<string,string>={};
  for(const name of ["comision","programador","arbitro","lector","ajeno"]){
    people[name]=await scalar("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES($1,'Sintético') RETURNING id",[name]);
    actors[name]=await scalar("INSERT INTO sports_management.users(person_id,username,email,password_hash,is_active,must_change_password) VALUES($1,$2,$3,$4,true,false) RETURNING id",[people[name],`arbitraje_${name}`,`${name}@example.test`,hash]);
  }
  await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','Fixture local PDGLD-141',false)",[actors.comision]);
  const fixturePrisma=new PrismaClient({adapter:new SerialPrismaPg({connectionString:adminUrl})});
  try{await fixturePrisma.$transaction(async tx=>{await installPermissionCatalog(tx,INITIAL_PERMISSION_GRANTS,actors.comision);await installLeagueCreationPermission(tx,actors.comision);},{timeout:20000});}finally{await fixturePrisma.$disconnect();}
  const league=await scalar("INSERT INTO sports_management.leagues(name) VALUES('Liga arbitraje sintética') RETURNING id");
  const otherLeague=await scalar("INSERT INTO sports_management.leagues(name) VALUES('Liga ajena sintética') RETURNING id");
  const sport=(await db.query("SELECT id FROM sports_management.sports LIMIT 1")).rows[0].id;
  const season=await scalar("INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date) VALUES($1,$2,'Temporada sintética', '2026-01-01','2027-12-31') RETURNING id",[league,sport]);
  for(const [name,role]of [["comision","REFEREE_MANAGER"],["programador","SCHEDULER"],["arbitro","REFEREE"],["lector","SUPERADMIN"],["ajeno","REFEREE_MANAGER"]])await db.query("INSERT INTO sports_management.user_roles(user_id,role_id,league_id) SELECT $1,id,$3 FROM sports_management.roles WHERE code=$2",[actors[name],role,name==="ajeno"?otherLeague:league]);
  const rule=await scalar("INSERT INTO sports_management.competition_rules(season_id,version_number,status,approved_by,approved_at) VALUES($1,1,'APPROVED',$2,now()) RETURNING id",[season,actors.comision]);
  const category=await scalar("INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES($1,$2,'Libre') RETURNING id",[league,sport]);
  const sc=await scalar("INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date,competition_format) VALUES($1,$2,$3,1,'OPEN','2026-12-31','GROUP_STAGE') RETURNING id",[season,category,rule]);
  const group=await scalar("INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES($1,$2,'A') RETURNING id",[season,sc]);
  const presenting=await scalar("INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES($1,'141-P','Presentador') RETURNING id",[league]);
  const clubs=[presenting];const teams:string[]=[];
  for(const name of ["Local","Visitante","Tercero"]){clubs.push(await scalar("INSERT INTO sports_management.clubs(league_id,reference_number,name) VALUES($1,$2,$3) RETURNING id",[league,`141-${name}`,name]));}
  for(const club of clubs)await db.query("INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by) VALUES($1,$2,$3,$4,'Demo','APPROVED',$5)",[season,club,league,`A-${club}`,actors.comision]);
  for(const club of clubs.slice(1)){
    const team=await scalar("INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES($1,$2,$2) RETURNING id",[club,`Equipo-${teams.length}`]);
    const enrollment=await scalar("INSERT INTO sports_management.season_teams(season_id,team_id,club_id,season_category_id,status) VALUES($1,$2,$3,$4,'REGISTERED') RETURNING id",[season,team,club,sc]);
    await db.query("UPDATE sports_management.season_teams SET group_id=$2 WHERE id=$1",[enrollment,group]);teams.push(enrollment);
  }
  const day=await scalar("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) VALUES($1,1,'2026-12-05','2026-12-05') RETURNING id",[season]);
  const venue=await scalar("INSERT INTO sports_management.venues(league_id,code,name,address,match_duration_minutes) VALUES($1,'141','Cancha sintética','Sin domicilio real',120) RETURNING id",[league]);
  await db.query("INSERT INTO sports_management.venue_availability(venue_id,starts_at,ends_at,type) VALUES($1,'2026-12-05T14:00Z','2026-12-05T22:00Z','AVAILABLE')",[venue]);
  const match=await scalar("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id) VALUES($1,$2,$3,'REAL-141',$4,$5,$6,'2026-12-05T16:00Z','2026-12-05T18:00Z','2026-12-05T18:00Z',sports_management.get_match_status_id('SCHEDULED')) RETURNING id",[season,group,day,teams[0],teams[1],venue]);
  // Rama negativa: el club Tercero tiene equipo en el grupo sin jugar el partido.
  const conflictPerson=await scalar("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Conflicto','Sintético') RETURNING id");
  await db.query("INSERT INTO sports_management.club_officers(affiliation_id,person_id,office,starts_at) SELECT id,$2,'SECRETARY','2026-01-01' FROM sports_management.club_affiliations WHERE club_id=$1 AND season_id=$3",[clubs[3],conflictPerson,season]);
  // El rol de árbitro es una cuenta preexistente, independiente del registro.
  await db.query(`COMMENT ON DATABASE "${database}" IS '${PREVIEW_MARKER}'`);
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='sports_management'")).rows;
  for(const t of tables)await db.query(`ALTER TABLE sports_management."${t.tablename}" ENABLE ROW LEVEL SECURITY`);
  await provisionPreviewRuntime(db);
  await db.query(`ALTER ROLE gestor_ligas_preview LOGIN PASSWORD '${runtimePassword}'`);
  Object.assign(process.env,env,{DATABASE_URL:runtimeUrl});
  const {mutateRefereeing,assessAssignment}=await import("../src/features/referees/server/service");
  const {getPrisma}=await import("../src/server/db/prisma");
  const {getRefereeWorkspaceForActor}=await import("../src/features/referees/server/queries");
  const {assertOwnRefereeAssignment}=await import("../src/server/auth/authorization-domain");
  const command=(kind:string,more:Record<string,unknown>)=>({kind,leagueId:league,seasonId:season,reason:"Validación local sintética",operationKey:randomUUID(),...more});
  const register=command("register",{personId:people.arbitro,clubId:presenting,active:true,expectedVersion:0});
  const referee=await mutateRefereeing(actors.comision,register);
  assert.deepEqual(await mutateRefereeing(actors.comision,register),referee);
  const availability=await mutateRefereeing(actors.comision,command("availability",{refereeId:referee.id,expectedVersion:referee.version,startsAt:"2026-12-05T14:00:00Z",endsAt:"2026-12-05T22:00:00Z",available:true}));
  const interval=(await getRefereeWorkspaceForActor(actors.comision,league,season)).data.availability[0];
  await mutateRefereeing(actors.comision,command("availability",{refereeId:referee.id,intervalId:interval.id,expectedVersion:availability.version,startsAt:interval.startsAt,endsAt:"2026-12-05T23:00:00Z",available:true}));
  const proposal=await mutateRefereeing(actors.programador,command("propose",{refereeId:referee.id,matchId:match,expectedMatchVersion:1}));
  await assert.rejects(getPrisma().$transaction(tx=>assertOwnRefereeAssignment(tx,actors.arbitro,match)));
  await assert.rejects(mutateRefereeing(actors.lector,command("approve",{assignmentId:proposal.id,expectedVersion:proposal.version,expectedMatchVersion:1})));
  await assert.rejects(getRefereeWorkspaceForActor(actors.ajeno,league,season));
  const approve=command("approve",{assignmentId:proposal.id,expectedVersion:proposal.version,expectedMatchVersion:1});
  const approve2={...approve,operationKey:randomUUID()};
  const race=await Promise.allSettled([mutateRefereeing(actors.comision,approve),mutateRefereeing(actors.comision,approve2)]);
  assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
  const winner=race.findIndex(r=>r.status==="fulfilled");
  const approved=(race[winner] as PromiseFulfilledResult<{id:string;version:number;operationKey:string}>).value;
  assert.deepEqual(await mutateRefereeing(actors.comision,winner===0?approve:approve2),approved);
  await getPrisma().$transaction(tx=>assertOwnRefereeAssignment(tx,actors.arbitro,match));
  const current=(await getRefereeWorkspaceForActor(actors.comision,league,season)).data.referees.find(r=>r.id===referee.id)!;
  await assert.rejects(mutateRefereeing(actors.comision,command("availability",{refereeId:referee.id,expectedVersion:current.version,startsAt:"2026-12-05T16:00:00Z",endsAt:"2026-12-05T18:00:00Z",available:false})));
  assert.equal((await getRefereeWorkspaceForActor(actors.comision,league,season)).data.referees.find(r=>r.id===referee.id)!.version,current.version);
  const conflicted=await mutateRefereeing(actors.comision,command("register",{personId:conflictPerson,clubId:clubs[3],active:true,expectedVersion:0}));
  const assessment=await getPrisma().$transaction(tx=>assessAssignment(tx,match,conflicted.id));
  assert.ok(assessment.blockers.some(b=>b.code==="CLUB_IN_GROUP"));
  const workspace=await getRefereeWorkspaceForActor(actors.comision,league,season);assert.equal(workspace.data.assignments.length,1);
  if(process.argv.includes("--acceptance")){
    const {verifyRefereeingAcceptance}=await import("../tests/integration/refereeing-acceptance");
    const acceptance=await verifyRefereeingAcceptance({db,actors,people,league,season,sc,group,clubs,referee:referee.id,version});
    const {verifyRefereeingAdditions}=await import("../tests/integration/refereeing-additions");
    await verifyRefereeingAdditions({db,actors,league,season,clubs,referee:referee.id});
    const {verifyRefereeHistory}=await import("../tests/integration/referee-history");
    await verifyRefereeHistory({db,actors,league,season,sc,newMatch:acceptance.newMatch,newRef:acceptance.newRef});
    if(process.argv.includes("--http")){
      const base=env.NEXTAUTH_URL;
      app=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port","3193"],{env:{...env,DATABASE_URL:runtimeUrl},stdio:["ignore","pipe","pipe"],windowsHide:true});
      let ready=false;
      for(let attempt=0;attempt<180;attempt++){
        if(app.exitCode!==null)throw Error("ACCEPTANCE_APPLICATION_EXITED");
        try{const response=await fetch(`${base}/api/auth/csrf`,{signal:AbortSignal.timeout(2000)});if(response.ok){ready=true;break;}}catch{}
        await new Promise(r=>setTimeout(r,500));
      }
      if(!ready)throw Error("ACCEPTANCE_APPLICATION_NOT_READY");
      const {verifyRefereeingHttp}=await import("../tests/integration/refereeing-http");
      await verifyRefereeingHttp({db,actors,league,season,referee:referee.id,base,newMatch:acceptance.newMatch});
      app.kill();await new Promise(r=>app!.once("exit",r));app=undefined;
    }
  }
  if(!serve){
    await mutateRefereeing(actors.comision,command("revoke",{assignmentId:approved.id,expectedVersion:approved.version,expectedMatchVersion:1}));
    await assert.rejects(getPrisma().$transaction(tx=>assertOwnRefereeAssignment(tx,actors.arbitro,match)));
    const next=await mutateRefereeing(actors.programador,command("propose",{refereeId:referee.id,matchId:match,expectedMatchVersion:1}));
    await mutateRefereeing(actors.comision,command("approve",{assignmentId:next.id,expectedVersion:next.version,expectedMatchVersion:1}));
    await db.query("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('FINISHED') WHERE id=$1",[match]);
    const historical=await getRefereeWorkspaceForActor(actors.comision,league,season);
    assert.ok(historical.data.history.some(h=>h.matchId===match));assert.ok(historical.data.history.filter(h=>h.matchId===match).every(h=>h.identity.source==="MATCH_CLOSURE_V1"));
    await assert.rejects(db.query("UPDATE sports_management.people SET first_name='Cambio actual' WHERE id=$1",[people.arbitro]),/HISTORICAL_CORRECTION_REQUIRED/);
  }
  console.log("Validación local: migraciones, RLS/rol Preview, padrón, disponibilidad, propuesta sin acceso, permiso de Comisión, idempotencia, grupo completo y revocación: OK.");
  if(serve)console.log("Usuarios sintéticos disponibles para revisión manual; consultar la guía local.");
  await getPrisma().$disconnect();
  if(serve){
    console.log("Aplicación aislada: http://127.0.0.1:3193/referees · Ctrl+C elimina únicamente este contenedor temporal.");
    app=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port","3193"],{env:{...env,DATABASE_URL:runtimeUrl},stdio:"inherit",windowsHide:true});
    await new Promise<void>(resolve=>{process.once("SIGINT",()=>{app?.kill();resolve();});app!.once("exit",()=>resolve());});
  }
} finally {
  if(app?.pid && app.exitCode===null){if(process.platform==="win32")spawnSync("taskkill",["/PID",String(app.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});else app.kill("SIGTERM");}
  await db?.end();if(created)docker(["rm","-f",container]);
}
