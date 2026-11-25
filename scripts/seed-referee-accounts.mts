import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import { readDevelopmentSeedDatabaseUrl } from "../prisma/seed-env";
import { DEMO_CONTEXT, DEMO_PASSWORD } from "../prisma/seed-demo-data";
import { getPrisma } from "../src/server/db/prisma";
import { assertAccountAdministrator } from "../src/server/auth/account-administrator";
import { assertCanGrantRole, lockAuthorization } from "../src/server/auth/authorization";
import { hashPassword } from "../src/server/auth/password";

nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const accounts=[
  {username:"arbitraje_comision",role:"REFEREE_MANAGER",name:"Comisión arbitral sintética"},
  {username:"arbitraje_arbitro",role:"REFEREE",name:"Árbitro sintético"},
] as const;
function id(label:string){const hex=createHash("sha256").update(`local-referee-accounts:141:v1:${label}`).digest("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
let db:ReturnType<typeof getPrisma>|undefined;
let stage="local-target";
try {
  readDevelopmentSeedDatabaseUrl();
  if(new URL(process.env.DATABASE_URL!).port!=="5433")throw Error("LOCAL_ONLY");
  db=getPrisma();
  const passwordHash=await hashPassword(DEMO_PASSWORD);
  const result=await db.$transaction(async tx=>{
    stage="profile";
    await lockAuthorization(tx,"exclusive");
    const [target]=await tx.$queryRaw<{name:string;managed:boolean}[]>`SELECT current_database()::text AS name,to_regnamespace('auth') IS NOT NULL OR to_regnamespace('storage') IS NOT NULL AS managed`;
    if(target.name!=="gestor_ligas_dev"||target.managed)throw Error("LOCAL_ONLY");
    const profile=await tx.audit_logs.findUnique({where:{id:"54000000-0000-4000-8000-000000000052"},select:{action:true,table_name:true}});
    if(profile?.action!=="INSTALL"||profile.table_name!=="seed_demo_profile")throw Error("DEMO_PROFILE_REQUIRED");
    const admin=await tx.users.findFirstOrThrow({where:{username:"demo-admin"},select:{id:true}});
    stage="account-authority";
    await assertAccountAdministrator(tx,admin.id,"CREATE",{leagueId:DEMO_CONTEXT.leagueId});
    const marker=await tx.audit_logs.findUnique({where:{id:id("installed")},select:{action:true,table_name:true}});
    if(marker){if(marker.action!=="INSTALL"||marker.table_name!=="seed_referee_accounts")throw Error("MARKER_CONFLICT");return {created:0,alreadyInstalled:true};}
    await tx.$queryRaw`SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','PDGLD-86: cuentas sintéticas solicitadas para Docker local',true)`;
    for(const account of accounts){
      stage=`role-authority:${account.role}`;
      const role=await tx.roles.findUniqueOrThrow({where:{code:account.role},select:{id:true}});
      await assertCanGrantRole(tx,admin.id,role.id,{leagueId:DEMO_CONTEXT.leagueId});
      stage=`create:${account.role}`;
      if(await tx.users.findFirst({where:{OR:[{username:account.username},{email:`${account.username}@demo.example.test`}]},select:{id:true}}))throw Error("ACCOUNT_NAME_OCCUPIED");
      const person=await tx.people.create({data:{id:id(`${account.username}:person`),first_name:account.name,paternal_surname:"Prueba local"},select:{id:true}});
      const user=await tx.users.create({data:{id:id(`${account.username}:user`),person_id:person.id,username:account.username,email:`${account.username}@demo.example.test`,password_hash:passwordHash,is_active:true,must_change_password:true},select:{id:true}});
      await tx.user_roles.create({data:{user_id:user.id,role_id:role.id,league_id:DEMO_CONTEXT.leagueId}});
      await tx.audit_logs.create({data:{user_id:admin.id,action:"ACCOUNT_CREATED",table_name:"users",entity_id:user.id,reason:"Cuenta sintética solicitada para revisión local de arbitraje",new_data:{personId:person.id,roleId:role.id,leagueId:DEMO_CONTEXT.leagueId,mustChangePassword:true}}});
    }
    await tx.audit_logs.create({data:{id:id("installed"),user_id:admin.id,action:"INSTALL",table_name:"seed_referee_accounts",reason:"PDGLD-86: dos cuentas sintéticas locales; sin modificar usuarios existentes"}});
    return {created:accounts.length,alreadyInstalled:false};
  },{timeout:20000});
  console.log(JSON.stringify({...result,users:accounts.map(a=>({username:a.username,role:a.role})),league:DEMO_CONTEXT.leagueName,temporaryPassword:"Ver DEMO_PASSWORD en prisma/seed-demo-data.ts; cambio obligatorio"}));
} catch(error) {console.error(JSON.stringify({code:"REFEREE_ACCOUNTS_NOT_INSTALLED",stage,errorCode:error instanceof Error && "code" in error ? error.code : "CHECK_FAILED",name:error instanceof Error ? error.name : "unknown",guard:error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : undefined}));process.exitCode=1;}
finally {await db?.$disconnect();}
