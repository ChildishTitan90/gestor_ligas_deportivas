import {randomBytes,randomUUID,createHash} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import argon2 from "argon2";
import {getPrisma} from "../../src/server/db/prisma";
import {isManualPlayerDatabase} from "../../src/features/players/server/manual-player-scenario";
import {INITIAL_PERMISSION_GRANTS} from "../../prisma/permissions-data";

// Solo fixtures: no consulta proveedores ni escribe documentos en Storage.
const sessionFile=resolve(process.env.PLAYER_DEMO_SESSION_FILE ?? "");
if(!isManualPlayerDatabase(process.env) || dirname(sessionFile)!==resolve(tmpdir()) || !/^pdgld-player-manual-[a-f0-9]+\.json$/.test(sessionFile.split(/[\\/]/).pop() ?? ""))throw new Error("Fixture manual no autorizado");
const db=getPrisma();
try{
  const password=`Manual-${randomBytes(15).toString("base64url")}!`;
  const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  const fixture=await db.$transaction(async tx=>{
    const league=await tx.leagues.create({data:{name:"PRUEBA AISLADA · Documentos e identidad"}});
    const club=await tx.clubs.create({data:{league_id:league.id,name:"PRUEBA AISLADA · Club",reference_number:"MANUAL-14-CLUB"}});
    const accounts=[];
    for(const [code,email] of [["CLUB_DELEGATE","delegado@manual.example.test"],["SECRETARY","secretaria@manual.example.test"]] as const){
      const person=await tx.people.create({data:{first_name:"Cuenta sintética",paternal_surname:code}});
      const user=await tx.users.create({data:{person_id:person.id,username:code==="SECRETARY"?"manual-secretaria":"manual-delegado",email,password_hash:passwordHash,must_change_password:false}});
      await tx.$queryRaw`SELECT set_config('app.user_id',${user.id},true),set_config('app.reason','Fixture manual aislado PDGLD-14',true)`;
      const role=await tx.roles.findUniqueOrThrow({where:{code}});
      for(const grant of INITIAL_PERMISSION_GRANTS.filter(g=>g.roleCode===code && g.module==="players")){
        const permission=await tx.permissions.upsert({where:{module_action:{module:grant.module,action:grant.action}},update:{},create:{module:grant.module,action:grant.action}});
        await tx.role_permissions.upsert({where:{role_id_permission_id:{role_id:role.id,permission_id:permission.id}},update:{context_only:grant.contextOnly},create:{role_id:role.id,permission_id:permission.id,context_only:grant.contextOnly}});
      }
      await tx.user_roles.create({data:{user_id:user.id,role_id:role.id,league_id:league.id,club_id:code==="CLUB_DELEGATE"?club.id:null,delegate_position:code==="CLUB_DELEGATE"?"PRIMARY":null,starts_at:new Date(Date.now()-60000)}});
      accounts.push({id:user.id,email,password});
    }
    const soccer=await tx.sports.findUniqueOrThrow({where:{code:"SOCCER"}});
    const cases=[];
    for(const mode of ["MINOR_FLOW","VETERAN_FLOW"] as const){
      const name=mode==="MINOR_FLOW"?"PRUEBA · Escolar y tutor (edad real conservada)":"PRUEBA · INE Veteranos (sin elegibilidad deportiva)";
      const year=new Date().getUTCFullYear();
      const season=await tx.seasons.create({data:{league_id:league.id,sport_id:soccer.id,name,start_date:new Date(`${year}-01-01`),end_date:new Date(`${year}-12-31`)}});
      const rule=await tx.competition_rules.create({data:{season_id:season.id,version_number:1}});
      const category=await tx.categories.create({data:{league_id:league.id,sport_id:soccer.id,name}});
      const sc=await tx.season_categories.create({data:{season_id:season.id,category_id:category.id,competition_rule_id:rule.id,hierarchy_order:1,type:mode==="MINOR_FLOW"?"OPEN":"VETERANS",minimum_age:mode==="VETERAN_FLOW"?35:null,age_cutoff_date:season.start_date,eligibility_pending:true}});
      const curp=await tx.document_types.findUniqueOrThrow({where:{code:"CURP"}});
      await tx.document_requirements.create({data:{season_category_id:sc.id,document_type_id:curp.id,quantity:1,is_required:true}});
      const group=await tx.groups.create({data:{season_id:season.id,season_category_id:sc.id,name:"Grupo de prueba"}});
      const affiliation=await tx.club_affiliations.create({data:{club_id:club.id,season_id:season.id,league_id:league.id,reference_number:`MANUAL-${mode}`,uniform_colors:"Azul sintético",requested_by:accounts[0].id,status:"APPROVED",reviewed_by:accounts[1].id,reviewed_at:new Date(),review_reason:"Fixture sin validez deportiva"}});
      await tx.club_affiliation_categories.create({data:{affiliation_id:affiliation.id,season_id:season.id,category_id:category.id,authorized_by:accounts[1].id,authorized_at:new Date()}});
      const team=await tx.teams.create({data:{club_id:club.id,name,reference_number:`MANUAL-${mode}`}});
      const enrolled=await tx.season_teams.create({data:{club_id:club.id,season_id:season.id,team_id:team.id,group_id:group.id,enrolled_by:accounts[0].id,enrolled_at:new Date(),enrollment_key:randomUUID(),enrollment_hash:createHash('sha256').update(`manual:${team.id}`).digest('hex')}});
      await tx.audit_logs.create({data:{user_id:accounts[1].id,action:"MANUAL_PLAYER_SCENARIO",table_name:"season_teams",entity_id:enrolled.id,reason:"Prueba humana aislada; conserva nacimiento real y bloquea habilitación deportiva",new_data:{mode}}});
      cases.push({mode,seasonTeamId:enrolled.id,name});
    }
    return {accounts,cases};
  },{timeout:30000});
  await writeFile(sessionFile,JSON.stringify({url:process.env.NEXTAUTH_URL,localUrl:process.env.PLAYER_DEMO_LOCAL_URL,database:new URL(process.env.DATABASE_URL!).pathname.slice(1),...fixture},null,2),{mode:0o600,flag:"wx"});
  console.log("Dos recorridos y cuentas sintéticas preparados. Credenciales solo en el manifiesto privado.");
}catch{console.error("No se prepararon los fixtures manuales; la transacción se revirtió. No se muestran datos SQL.");process.exitCode=1;}
finally{await db.$disconnect();}
