import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import * as argon2 from "argon2";
import {PrismaClient} from "@prisma/client";
import {SerialPrismaPg} from "../src/server/db/transaction-queue";
import {installPermissionCatalog,installLeagueCreationPermission} from "../prisma/seed-permissions";
import { INITIAL_PERMISSION_GRANTS } from "../prisma/permissions-data";
import assert from "node:assert/strict";
import {childEnvironment} from "./ci/delegate-isolated-runtime.mjs";

// Herramienta manual de revisión, sin conexión heredada ni volúmenes. --serve
// deja la aplicación disponible hasta Ctrl+C; el contenedor pertenece al proceso.
const nonce = randomBytes(8).toString("hex"), container = `pdgld147-${nonce}`, database = `pdgld48_test_${nonce}`;
const docker = (args: string[]) => execFileSync("docker", args, { encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","pipe"] }).trim();
let created = false; let app: ReturnType<typeof spawn>|undefined; let db: pg.Client|undefined;
const serve = process.argv.includes("--serve");
const automatedOffline = process.argv.includes("--verify-offline");
const appPort = automatedOffline ? "3298" : process.argv.includes("--http") ? "3398" : "3198";
const version=process.argv.find(a=>a.startsWith("--postgres="))?.split("=")[1]??"15";
if(!["15","17"].includes(version))throw Error("INVALID_POSTGRES_VERSION");
try {
  docker(["run","-d","--name",container,"--label","pdgld.ticket=PDGLD-147","-e","POSTGRES_HOST_AUTH_METHOD=trust","-e",`POSTGRES_DB=${database}`,"-p","127.0.0.1::5432",`postgres:${version}`]); created=true;
  const port=docker(["port",container,"5432/tcp"]).split(":").at(-1)!;
  const adminUrl=`postgresql://postgres:synthetic-local-only@127.0.0.1:${port}/${database}`;
  const runtimePassword=randomBytes(24).toString("hex");
  const runtimeUrl=`postgresql://gestor_ligas_preview:${runtimePassword}@127.0.0.1:${port}/${database}`;
  const env={...childEnvironment(process.env),NODE_ENV:"development" as const,
    DATABASE_URL:adminUrl,DIRECT_URL:adminUrl,NEXTAUTH_URL:`http://127.0.0.1:${appPort}`,NEXTAUTH_SECRET:randomBytes(48).toString("hex"),AUTH_TEST_RUN:"1",MATCH_REPORT_OFFLINE_TEST:automatedOffline ? "1" : "",
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
  await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','Fixture local PDGLD-147',false)",[actors.comision]);
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
  const match=await scalar("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id) VALUES($1,$2,$3,'REAL-147',$4,$5,$6,'2026-12-05T16:00Z','2026-12-05T18:00Z','2026-12-05T18:00Z',sports_management.get_match_status_id('SCHEDULED')) RETURNING id",[season,group,day,teams[0],teams[1],venue]);

  const { runReportAcceptance } = await import("../tests/integration/match-reports");
  await runReportAcceptance({ db, actors, people, league, otherLeague, season, sc, category, rule, group, clubs, teams, match, presenting, scalar, runtimeUrl, env, runtimePassword, serve });
} finally {
  if(app?.pid && app.exitCode===null){if(process.platform==="win32")spawnSync("taskkill",["/PID",String(app.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});else app.kill("SIGTERM");}
  await db?.end();if(created)docker(["rm","-f",container]);
}
