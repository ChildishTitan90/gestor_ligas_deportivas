import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import nextEnv from "@next/env";
import {readDevelopmentSeedDatabaseUrl} from "../prisma/seed-env";
import {getPrisma} from "../src/server/db/prisma";
import {lockRefereeing,ensurePresentingClub} from "../src/features/referees/server/service";
import {mutatePresentationInTransaction} from "../src/features/referees/server/presentations";
import {readRefereeClubQuotas} from "../src/features/referees/server/club-quota";
import {provisionRefereeAccessInTransaction} from "../src/features/accounts/server/referee-access";
import {getPermissionGrants} from "../src/server/auth/authorization";
import {runtimePrivileges} from "./preview/runtime-plan.mjs";
// Revisión puntual sobre Docker autorizado: todos los fixtures/operaciones se
// revierten en UNA transacción; no crea otra base, contenedor o cuenta permanente.
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
const rollback=new Error("ROLLBACK_VALIDATION_COMPLETE");
let stage="target";let db:ReturnType<typeof getPrisma>|undefined;
try{
  readDevelopmentSeedDatabaseUrl();if(new URL(process.env.DATABASE_URL!).port!=="5433")throw Error("LOCAL_ONLY");
  db=getPrisma();const before=await db.referee_presentations.count();
  try{await db.$transaction(async tx=>{
    await lockRefereeing(tx);
    const [target]=await tx.$queryRaw<{name:string}[]>`SELECT current_database()::text AS name`;
    if(target.name!=="gestor_ligas_dev")throw Error("LOCAL_ONLY");
    const nonce=randomUUID().slice(0,8),actors:Record<string,string>={};
    stage="actors";
    for(const code of ["delegate","commission"]){const p=await tx.people.create({data:{first_name:`Validación ${nonce}`,paternal_surname:code},select:{id:true}});const u=await tx.users.create({data:{person_id:p.id,username:`validation_${code}_${nonce}`,email:`${code}_${nonce}@example.test`,password_hash:"synthetic-unusable-hash",is_active:true,must_change_password:false},select:{id:true}});actors[code]=u.id;}
    await tx.$queryRaw`SELECT set_config('app.user_id',${actors.commission},true),set_config('app.reason','Validación sintética transaccional de prerregistro',true)`;
    const league=await tx.leagues.create({data:{name:`VALIDACIÓN ROLLBACK ${nonce}`},select:{id:true}}),sport=await tx.sports.findFirstOrThrow({select:{id:true}});
    const season=await tx.seasons.create({data:{league_id:league.id,sport_id:sport.id,name:`Periodo ${nonce}`,start_date:new Date("2026-01-01Z"),end_date:new Date("2026-12-31Z")},select:{id:true}});
    const next=await tx.seasons.create({data:{league_id:league.id,sport_id:sport.id,name:`Periodo siguiente ${nonce}`,start_date:new Date("2027-01-01Z"),end_date:new Date("2027-12-31Z")},select:{id:true}});
    const a=await tx.clubs.create({data:{league_id:league.id,name:`Club A ${nonce}`,reference_number:`A-${nonce}`},select:{id:true}}),b=await tx.clubs.create({data:{league_id:league.id,name:`Club B ${nonce}`,reference_number:`B-${nonce}`},select:{id:true}});
    for(const [club,period]of [[a,season],[b,season],[a,next]])await tx.club_affiliations.create({data:{club_id:club.id,season_id:period.id,league_id:league.id,reference_number:`${club.id}-${period.id}`,uniform_colors:"Sintético",status:"APPROVED",requested_by:actors.delegate},select:{id:true}});
    const delegate=await tx.roles.findUniqueOrThrow({where:{code:"CLUB_DELEGATE"},select:{id:true}}),commission=await tx.roles.findUniqueOrThrow({where:{code:"REFEREE_MANAGER"},select:{id:true}});
    await tx.user_roles.create({data:{user_id:actors.delegate,role_id:delegate.id,league_id:league.id,club_id:a.id,delegate_position:"PRIMARY"},select:{id:true}});
    await tx.user_roles.create({data:{user_id:actors.commission,role_id:commission.id,league_id:league.id},select:{id:true}});
    const rule=await tx.competition_rules.create({data:{season_id:season.id,version_number:1},select:{id:true}}),category=await tx.categories.create({data:{league_id:league.id,sport_id:sport.id,name:"Categoría sintética"},select:{id:true}});
    const sc=await tx.season_categories.create({data:{season_id:season.id,category_id:category.id,competition_rule_id:rule.id,hierarchy_order:1,type:"OPEN",competition_format:"GROUP_STAGE",age_cutoff_date:new Date("2026-12-31Z")},select:{id:true}});
    for(let i=0;i<5;i++){const t=await tx.teams.create({data:{club_id:a.id,name:`Equipo ${i}`,reference_number:`T-${nonce}-${i}`},select:{id:true}});await tx.season_teams.create({data:{season_id:season.id,club_id:a.id,team_id:t.id,season_category_id:sc.id,status:"REGISTERED"},select:{id:true}});}
    stage="submission";
    const peopleBefore=await tx.people.count(),usersBefore=await tx.users.count();
    const submit={kind:"submit",operationKey:randomUUID(),clubId:a.id,seasonId:season.id,reason:"Candidato sintético del club",candidate:{mode:"new",firstName:`Candidato ${nonce}`,paternalSurname:"Prueba",maternalSurname:""}};
    const request=await mutatePresentationInTransaction(tx,actors.delegate,submit);
    assert.deepEqual(await mutatePresentationInTransaction(tx,actors.delegate,submit),request);
    assert.equal(await tx.people.count(),peopleBefore);
    let quota=(await readRefereeClubQuotas(tx,season.id,[a.id]))[0];assert.equal(quota.registeredTeams,5);assert.equal(Math.ceil(quota.registeredTeams/4),2);assert.equal(quota.presented,0);
    await assert.rejects(mutatePresentationInTransaction(tx,actors.delegate,{...submit,operationKey:randomUUID(),clubId:b.id}));
    await assert.rejects(mutatePresentationInTransaction(tx,actors.delegate,{kind:"accept",presentationId:request.id,expectedVersion:1,operationKey:randomUUID(),reason:"No debe poder aprobar",confirmNewPerson:true}));
    stage="incorporation";
    const accept={kind:"accept",presentationId:request.id,expectedVersion:1,operationKey:randomUUID(),reason:"Identidad y presentación revisadas",confirmNewPerson:true};
    const approved=await mutatePresentationInTransaction(tx,actors.commission,accept);
    assert.deepEqual(await mutatePresentationInTransaction(tx,actors.commission,accept),approved);
    const row=await tx.referee_presentations.findUniqueOrThrow({where:{id:request.id},select:{status:true,referee_id:true,approved_person_id:true}});
    assert.equal(row.status,"APPROVED");assert.equal(await tx.people.count(),peopleBefore+1);assert.equal(await tx.users.count(),usersBefore);
    assert.equal(await tx.users.count({where:{person_id:row.approved_person_id!}}),0);
    quota=(await readRefereeClubQuotas(tx,season.id,[a.id]))[0];assert.equal(quota.presented,1);assert.equal(Math.max(0,Math.ceil(quota.registeredTeams/4)-quota.presented),1);
    await assert.rejects(ensurePresentingClub(tx,row.referee_id!,b.id,season.id));
    stage="database-origin-guard";
    await tx.$executeRawUnsafe("SAVEPOINT club_origin");
    await assert.rejects(tx.$executeRaw`UPDATE sports_management.club_season_referees SET club_id=${b.id}::uuid WHERE referee_id=${row.referee_id}::uuid AND season_id=${season.id}::uuid`);
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT club_origin");
    stage="season-renewal";
    const renew=await mutatePresentationInTransaction(tx,actors.delegate,{kind:"submit",operationKey:randomUUID(),clubId:a.id,seasonId:next.id,reason:"Renovación sintética de temporada",candidate:{mode:"existing",personId:row.approved_person_id}});
    await mutatePresentationInTransaction(tx,actors.commission,{kind:"accept",presentationId:renew.id,expectedVersion:1,operationKey:randomUUID(),reason:"Renovación revisada por Comisión",personId:row.approved_person_id,expectedIdentityVersion:1});
    assert.equal(await tx.people.count(),peopleBefore+1);assert.equal(await tx.users.count(),usersBefore);
    assert.equal(await tx.club_season_referees.count({where:{referee_id:row.referee_id!}}),2);
    stage="referee-access-permissions";
    assert.equal((await getPermissionGrants(tx,actors.commission,"users","CREATE")).length,0);
    assert.equal((await getPermissionGrants(tx,actors.commission,"users","UPDATE")).length,0);
    assert.ok((await getPermissionGrants(tx,actors.commission,"referee-accounts","CREATE")).length>0);
    const referee=await tx.referees.findUniqueOrThrow({where:{id:row.referee_id!},select:{version:true}});
    const create={kind:"create",refereeId:row.referee_id!,seasonId:season.id,expectedRefereeVersion:referee.version,expectedIdentityVersion:1,
      operationKey:randomUUID(),reason:"Acceso sintético de árbitro incorporado",username:`access_${nonce}`,email:`access_${nonce}@example.test`,temporaryPassword:`Synthetic-${nonce}-2026!`};
    await assert.rejects(provisionRefereeAccessInTransaction(tx,actors.delegate,create),{code:"FORBIDDEN"});
    await assert.rejects(provisionRefereeAccessInTransaction(tx,actors.commission,{...create,roles:["SUPERADMIN"]}),{code:"INVALID_PAYLOAD"});
    await assert.rejects(provisionRefereeAccessInTransaction(tx,actors.commission,{...create,refereeId:randomUUID()}),{code:"FORBIDDEN"});
    await assert.rejects(provisionRefereeAccessInTransaction(tx,actors.commission,{...create,expectedIdentityVersion:2}),{code:"STALE_VERSION"});
    stage="referee-access-create-and-replay";
    // Mismas ACL de tablas/columnas que Preview, sin alterar RLS de Docker.
    const limitedRole=`validation_referee_${nonce}`;
    const ident=(value:string)=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw Error("INVALID_FIXTURE_IDENTIFIER");return `"${value}"`;};
    await tx.$executeRawUnsafe(`CREATE ROLE ${ident(limitedRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA sports_management TO ${ident(limitedRole)}`);
    const spec=runtimePrivileges as {read:string[];readColumns:Record<string,string[]>;insert:Record<string,string[]>;update:Record<string,string[]>;lock:string[]};
    for(const table of spec.read){
      const object=`sports_management.${ident(table)}`,to=ident(limitedRole),columns=spec.readColumns[table];
      await tx.$executeRawUnsafe(`GRANT SELECT${columns?.length?` (${columns.map(ident).join(",")})`:""} ON ${object} TO ${to}`);
      if(spec.insert[table]?.length)await tx.$executeRawUnsafe(`GRANT INSERT (${spec.insert[table].map(ident).join(",")}) ON ${object} TO ${to}`);
      const update=spec.update[table]??(spec.lock.includes(table)?["id"]:[]);
      if(update.length)await tx.$executeRawUnsafe(`GRANT UPDATE (${update.map(ident).join(",")}) ON ${object} TO ${to}`);
    }
    await tx.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION sports_management.get_entity_season(text,uuid),sports_management.get_role_code(uuid),sports_management.player_participation_now(),sports_management.maintenance_has_references(text,uuid),sports_management.referee_assignment_blockers(uuid,uuid,uuid),sports_management.referee_assignment_effective(uuid),sports_management.closed_identity_reader_block(uuid) TO ${ident(limitedRole)}`);
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${ident(limitedRole)}`);
    const [privateInstaller]=await tx.$queryRaw<{allowed:boolean}[]>`SELECT has_function_privilege(current_user,'sports_management.install_referee_access_permission()','EXECUTE') AS allowed`;
    assert.equal(privateInstaller.allowed,false);
    stage="limited-role-create-account";
    const access=await provisionRefereeAccessInTransaction(tx,actors.commission,create);
    assert.deepEqual(await provisionRefereeAccessInTransaction(tx,actors.commission,create),access);
    await assert.rejects(provisionRefereeAccessInTransaction(tx,actors.commission,{...create,temporaryPassword:"Another-Synthetic-2026!"}),{code:"OPERATION_KEY_REUSED"});
    const user=await tx.users.findUniqueOrThrow({where:{id:access.id},select:{person_id:true,password_hash:true,username:true,email:true,must_change_password:true,version:true}});
    assert.equal(user.person_id,row.approved_person_id);assert.equal(user.must_change_password,true);assert.equal(await tx.users.count(),usersBefore+1);
    const accessRoles=await tx.user_roles.findMany({where:{user_id:access.id},select:{id:true,league_id:true,roles:{select:{code:true}}}});
    assert.equal(accessRoles.length,1);assert.equal(accessRoles[0].roles.code,"REFEREE");assert.equal(accessRoles[0].league_id,league.id);
    await assert.rejects(provisionRefereeAccessInTransaction(tx,actors.commission,{...create,operationKey:randomUUID()}),{code:"ACCOUNT_CHANGED"});
    // Cuenta preexistente: solo se añade el rol; no se alteran sus credenciales.
    stage="referee-access-existing-account";
    await tx.$executeRawUnsafe("RESET ROLE");
    await tx.user_roles.delete({where:{id:accessRoles[0].id}});
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${ident(limitedRole)}`);
    const enable={kind:"enable",refereeId:row.referee_id!,seasonId:season.id,expectedRefereeVersion:referee.version,expectedIdentityVersion:1,
      userId:access.id,expectedUserVersion:user.version,operationKey:randomUUID(),reason:"Habilitar acceso en cuenta sintética existente"};
    const enabled=await provisionRefereeAccessInTransaction(tx,actors.commission,enable);
    assert.deepEqual(await provisionRefereeAccessInTransaction(tx,actors.commission,enable),enabled);
    await provisionRefereeAccessInTransaction(tx,actors.commission,{...enable,operationKey:randomUUID()});
    assert.equal(await tx.user_roles.count({where:{user_id:access.id}}),1);
    assert.deepEqual(await tx.users.findUniqueOrThrow({where:{id:access.id},select:{person_id:true,password_hash:true,username:true,email:true,must_change_password:true,version:true}}),user);
    const [receipt]=await tx.$queryRaw<{input_hash:string;result:unknown}[]>`SELECT input_hash,result FROM sports_management.referee_operations WHERE actor_id=${actors.commission}::uuid AND operation_key=${create.operationKey}::uuid`;
    assert.equal(JSON.stringify(receipt).includes(create.temporaryPassword),false);
    const inactive=await tx.referees.update({where:{id:row.referee_id!},data:{is_active:false},select:{version:true}});
    await assert.rejects(provisionRefereeAccessInTransaction(tx,actors.commission,{...enable,operationKey:randomUUID(),expectedRefereeVersion:inactive.version}),{code:"REFEREE_INACTIVE"});
    await tx.$executeRawUnsafe("RESET ROLE");
    stage="permission-installation-keeps-revocation";
    const capability=await tx.permissions.findUniqueOrThrow({where:{module_action:{module:"referee-accounts",action:"CREATE"}},select:{id:true}});
    await tx.role_permissions.deleteMany({where:{role_id:commission.id,permission_id:capability.id}});
    await tx.$queryRaw`SELECT sports_management.install_referee_access_permission()::text`;
    assert.equal(await tx.role_permissions.count({where:{role_id:commission.id,permission_id:capability.id}}),0);
    throw rollback;
  },{timeout:30000});}catch(e){if(e!==rollback)throw e;}
  assert.equal(await db.referee_presentations.count(),before);
  console.log("OK: presentación, cuota, origen y renovación; acceso REFEREE por Comisión sin permisos generales de usuarios, misma Persona, cambio inicial obligatorio, cuenta existente intacta, idempotencia y versiones. Fixtures revertidos.");
}catch(e){
  const detail=JSON.stringify(e instanceof Error&&"meta"in e?e.meta:{}).match(/permission denied for (?:table|schema|function|column) [a-z_][a-z0-9_]*/i)?.[0];
  console.error(JSON.stringify({code:"PRESENTATION_LOCAL_CHECK_FAILED",stage,errorCode:e instanceof Error&&"code"in e?e.code:"CHECK_FAILED",name:e instanceof Error?e.name:"unknown",detail}));process.exitCode=1;
}
finally{await db?.$disconnect();}
