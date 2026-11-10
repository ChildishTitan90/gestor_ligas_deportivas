import {randomBytes,randomUUID,createHash} from "node:crypto";
import {readFile,writeFile,mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import nextEnv from "@next/env";
import pg from "pg";
import argon2 from "argon2";
import {readDevelopmentSeedDatabaseUrl} from "../../prisma/seed-env";
import {loadPermissionCatalog} from "../../prisma/permissions-catalog";
import {DEMO_PASSWORD} from "../../prisma/seed-demo-data";
import {seedDemoDatabase} from "../../prisma/seed-demo";
import {getPrisma} from "../../src/server/db/prisma";
import {getPlayerTeamOptionsForActor} from "../../src/features/players/server/workspace-queries";
import {resolveCategoryDocuments} from "../../src/features/players/server/category-document-requirements";
import {categoryDocumentPolicySchema,type CategoryDocumentPolicy} from "../../src/features/competitions/document-policy";

// Instalación humana explícita: sin consulta a proveedores ni modificaciones a Storage.
// Conserva la BD anterior y configura una base limpia aislada; nunca borra historial.
if(process.argv.slice(2).join(" ")!=="--activate" || process.env.NODE_ENV==="production")throw Error("LOCAL_LAB_EXPLICIT_ONLY");
Object.assign(process.env,{NODE_ENV:"development"});
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const original=readDevelopmentSeedDatabaseUrl(),source=new URL(original);source.search="";
const name=`pdgld48_test_${randomBytes(8).toString("hex")}`,target=new URL(source);target.pathname=`/${name}`;
const adminUrl=new URL(source);adminUrl.pathname="/postgres";
const admin=new pg.Client({connectionString:adminUrl.href,connectionTimeoutMillis:5000});
const envFile=join(process.cwd(),".env.local"),saved=await readFile(envFile,"utf8");
const backup=await mkdtemp(join(tmpdir(),"pdgld-local-player-lab-"));
await writeFile(join(backup,"previous.env.local"),saved,{mode:0o600,flag:"wx"});
let db:ReturnType<typeof getPrisma>|undefined,stage="conexión local";
try{
 await admin.connect();
 const check=await admin.query("SELECT datname FROM pg_database WHERE datname=$1",[source.pathname.slice(1)]);
 if(check.rowCount!==1)throw Error("SOURCE_MISSING");
 const sourceDb=new pg.Client({connectionString:source.href});await sourceDb.connect();
 try{const {rows}=await sourceDb.query("SELECT to_regnamespace('storage') IS NOT NULL OR to_regnamespace('auth') IS NOT NULL AS managed");if(rows[0].managed)throw Error("MANAGED_DATABASE_DENIED");}finally{await sourceDb.end();}
 stage="base nueva";await admin.query(`CREATE DATABASE "${name}"`);
 process.env.DATABASE_URL=target.href;process.env.DIRECT_URL=target.href;
 if(!["127.0.0.1","localhost","[::1]"].includes(target.hostname) || !/^pdgld48_test_[a-f0-9]{16}$/.test(name))throw Error("ISOLATION_GUARD");
 stage="migraciones";
 const migration=spawnSync(process.execPath,["node_modules/prisma/build/index.js","migrate","deploy"],{env:process.env,encoding:"utf8",windowsHide:true,timeout:120000});
 if(migration.status!==0)throw Error("MIGRATION_FAILED");
 db=getPrisma();stage="cuentas DEMO";
 await seedDemoDatabase(db,await loadPermissionCatalog());
 stage="liga y contextos";
 const fixture=await db.$transaction(async tx=>{
  const users=await tx.users.findMany({where:{email:{in:["admin@demo.example.test","secretario@demo.example.test","delegado-a@demo.example.test","delegado-b@demo.example.test","temporal@demo.example.test"]}},select:{id:true,email:true,password_hash:true,must_change_password:true,is_active:true}});
  if(users.length!==5)throw Error("DEMO_ACCOUNTS_MISSING");
  const actor=users.find(u=>u.email==="admin@demo.example.test")!,secretary=users.find(u=>u.email==="secretario@demo.example.test")!;
  await tx.$queryRaw`SELECT set_config('app.user_id',${actor.id},true),set_config('app.reason','Laboratorio local explícito: conserva nacimiento real, sin validez deportiva',true)`;
  const league=await tx.leagues.create({data:{name:"LAB · Registro, INE y tutor",timezone:"America/Mexico_City"}});
  const sport=await tx.sports.findUniqueOrThrow({where:{code:"SOCCER"}}),roles=await tx.roles.findMany({where:{code:{in:["SECRETARY","CLUB_DELEGATE"]}}});
  for(const user of [secretary,users.find(u=>u.email==="temporal@demo.example.test")!])await tx.user_roles.create({data:{user_id:user.id,role_id:roles.find(r=>r.code==="SECRETARY")!.id,league_id:league.id,starts_at:new Date(Date.now()-60000)}});
  const clubs=[];
  for(const suffix of ["a","b"]){const delegate=users.find(u=>u.email===`delegado-${suffix}@demo.example.test`)!;const club=await tx.clubs.create({data:{league_id:league.id,name:`LAB Club ${suffix.toUpperCase()}`,reference_number:`LAB-${suffix}-${name}`}});await tx.user_roles.create({data:{user_id:delegate.id,role_id:roles.find(r=>r.code==="CLUB_DELEGATE")!.id,league_id:league.id,club_id:club.id,delegate_position:"PRIMARY",starts_at:new Date(Date.now()-60000)}});clubs.push({club,delegate});}
  const cases=[];
  for(const mode of ["VETERAN_FLOW","MINOR_FLOW"] as const){
   const minor=mode==="MINOR_FLOW",label=minor?"Infantil · Escolar y firma del tutor (datos sintéticos de menor)":"Libre · INE y selfie (prueba)";
   // Temporadas distintas: la misma Persona puede recorrer ambos casos sin duplicar identidad.
   const year=new Date().getUTCFullYear();
   const season=await tx.seasons.create({data:{league_id:league.id,sport_id:sport.id,name:`LAB ${label}`,start_date:new Date(`${year}-01-01`),end_date:new Date(`${year}-12-31`)}});
   const rule=await tx.competition_rules.create({data:{season_id:season.id,version_number:1}});
   const category=await tx.categories.create({data:{league_id:league.id,sport_id:sport.id,name:label}});
   const documents:CategoryDocumentPolicy={version:1,profile:minor?"CHILDREN":"GENERAL",status:"APPROVED",pendingDecisions:[],activation:"ADMINISTRATIVE",requirements:[
    {key:"CURP",audience:"ALL",anyOf:["CURP"],quantity:1,requiredForDossier:true,requiredForEligibility:true},
    {key:"PLAYER_PHOTO",audience:"ALL",anyOf:["PHOTO"],quantity:1,requiredForDossier:false,requiredForEligibility:false},
    ...(minor?[
     {key:"BIRTH_EVIDENCE" as const,audience:"ALL" as const,anyOf:["CURP" as const],quantity:1,requiredForDossier:true,requiredForEligibility:true},
     {key:"SCHOOL_EVIDENCE" as const,audience:"MINORS" as const,anyOf:["STUDENT_ID" as const,"STUDENT_CERTIFICATE" as const],quantity:1,requiredForDossier:true,requiredForEligibility:true},
     {key:"GUARDIAN_CONSENT" as const,audience:"MINORS" as const,anyOf:["GUARDIAN_CONSENT" as const],quantity:1,requiredForDossier:true,requiredForEligibility:true},
    ]:[{key:"PHOTO_IDENTIFICATION" as const,audience:"ALL" as const,anyOf:["INE" as const],quantity:1,requiredForDossier:true,requiredForEligibility:true}])
   ]};categoryDocumentPolicySchema.parse(documents);
   const policy={referenceYear:year,minimumAge:minor?0:18,maximumAge:minor?17:null,exceptionMinimumAge:null,documents,registrationDays:[1,2,3,4,5,6,7],timezone:"America/Mexico_City",playersOnField:11,maximumCalledUp:22,maximumRoster:null};
   const sc=await tx.season_categories.create({data:{season_id:season.id,category_id:category.id,competition_rule_id:rule.id,type:minor?"YOUTH":"OPEN",hierarchy_order:1,competition_format:"GENERAL_TABLE",minimum_age:policy.minimumAge,maximum_age:policy.maximumAge,age_cutoff_date:new Date(`${year}-12-31`),eligibility_pending:false,player_policy:policy}});
   const group=await tx.groups.create({data:{season_id:season.id,season_category_id:sc.id,name:"General"}});
   for(const {club,delegate}of clubs){
    const affiliation=await tx.club_affiliations.create({data:{club_id:club.id,season_id:season.id,league_id:league.id,reference_number:`LAB-${randomUUID()}`,uniform_colors:"Azul y blanco",requested_by:delegate.id,status:"APPROVED",reviewed_by:secretary.id,reviewed_at:new Date(),review_reason:"Fixture local explícito; no representa aprobación real"}});
    await tx.club_affiliation_categories.create({data:{affiliation_id:affiliation.id,season_id:season.id,category_id:category.id,authorized_by:secretary.id,authorized_at:new Date()}});
    const team=await tx.teams.create({data:{club_id:club.id,name:`${club.name} · ${minor?"Tutor":"Libre INE"}`,reference_number:`LAB-${randomUUID()}`}});
    const st=await tx.season_teams.create({data:{club_id:club.id,season_id:season.id,team_id:team.id,group_id:group.id,enrolled_by:delegate.id,enrolled_at:new Date(),enrollment_key:randomUUID(),enrollment_hash:createHash("sha256").update(team.id).digest("hex")}});
    await tx.audit_logs.create({data:{user_id:actor.id,action:"MANUAL_PLAYER_SCENARIO",table_name:"season_teams",entity_id:st.id,reason:"LAB aislado: edades y días de prueba explícitos, sin habilitación deportiva",new_data:{mode}}});
    cases.push({mode,seasonTeamId:st.id,categoryId:sc.id,seasonId:season.id,label,delegateId:delegate.id});
   }
  }
  // Únicamente esta BD aislada: excepción de calendario solo para equipos con marcador.
  const [fn]=await tx.$queryRaw<{definition:string}[]>`SELECT pg_get_functiondef('sports_management.validate_player_registration()'::regprocedure) AS definition`;
  const old="IF extract(isodow FROM now() AT TIME ZONE 'America/Mexico_City') NOT BETWEEN 1 AND 3 THEN";
  if(!fn.definition.includes(old))throw Error("UNEXPECTED_REGISTRATION_GUARD");
  await tx.$executeRawUnsafe(fn.definition.replace(old,"IF extract(isodow FROM now() AT TIME ZONE 'America/Mexico_City') NOT BETWEEN 1 AND 3 AND NOT EXISTS(SELECT 1 FROM sports_management.audit_logs WHERE action='MANUAL_PLAYER_SCENARIO' AND table_name='season_teams' AND entity_id=NEW.season_team_id) THEN"));
  await tx.audit_logs.create({data:{user_id:actor.id,action:"INSTALL",table_name:"local_player_lab",entity_id:league.id,reason:"Política exclusiva del laboratorio: CURP como comprobante de nacimiento, rango adulto para recorrido infantil, todos los días; sin aprobación deportiva",new_data:{previousDatabase:source.pathname.slice(1),cases}}});
  return {leagueId:league.id,cases,users};
 },{timeout:30000});
 stage="comprobación";
 for(const user of fixture.users){if(!user.is_active || !await argon2.verify(user.password_hash,DEMO_PASSWORD))throw Error("DEMO_ACCESS_INVALID");if(user.must_change_password!==(user.email==="temporal@demo.example.test"))throw Error("PASSWORD_CHANGE_CASE_INVALID");}
 for(const delegate of new Set(fixture.cases.map(c=>c.delegateId))){const teams=await getPlayerTeamOptionsForActor(delegate);if(teams.filter(t=>t.clubName.startsWith("LAB")).length!==2)throw Error("CATALOG_SCOPE_INVALID");}
 for(const item of fixture.cases){const docs=await db.$transaction(tx=>resolveCategoryDocuments(tx,item.categoryId,item.mode==="MINOR_FLOW"));if(!docs.approved || !docs.requirements.some(r=>r.document_types.code===(item.mode==="MINOR_FLOW"?"GUARDIAN_CONSENT":"INE")))throw Error("DOCUMENTS_INVALID");}
 if(await db.player_registrations.count()!==0)throw Error("LAB_NOT_EMPTY");
 const set=(text:string,key:string,value:string)=>{const line=`${key}=${JSON.stringify(value)}`;return new RegExp(`^${key}=.*$`,"m").test(text)?text.replace(new RegExp(`^${key}=.*$`,"m"),()=>line):`${text.trimEnd()}\n${line}\n`;};
 let next=set(saved,"DATABASE_URL",target.href);next=set(next,"DIRECT_URL",target.href);
 await writeFile(join(backup,"manifest.json"),JSON.stringify({database:name,previousDatabase:source.pathname.slice(1),leagueId:fixture.leagueId,cases:fixture.cases},null,2),{mode:0o600});
 stage="activar configuración local";await writeFile(envFile,next);
 console.log(JSON.stringify({ready:true,database:name,league:"LAB · Registro, INE y tutor",players:0,cases:2,teams:4,accountsVerified:5,backup}));
}catch{console.error(`Preparación detenida en ${stage}. No se imprimen secretos; la base anterior permanece intacta.`);process.exitCode=1;}
finally{await db?.$disconnect();await admin.end();}
