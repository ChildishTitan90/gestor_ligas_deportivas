import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../src/server/db/prisma";
import { getAuditWorkspaceForActor, getAuditWorkspaceInTransaction, getAuditDetailForActor, AuditInputError } from "../../src/features/audit/server/queries";
import { applyClubOrTeamMaintenance } from "../../src/features/clubs/server/maintenance";
import { syntheticPlayerPolicy } from "../fixtures/player-document-policy";
import { hashPassword } from "../../src/server/auth/password";
import { verifyAuditHttp } from "./audit-http";

test("bitácora real: ámbito, datos mínimos, orden estable, inmutabilidad y rollback",async t=>{
  assert.equal(process.env.AUDIT_TEST_RUN,"1");
  const url=new URL(process.env.DATABASE_URL??"");
  assert.ok(["127.0.0.1","localhost","[::1]"].includes(url.hostname));
  assert.match(url.pathname,/^\/pdgld91_test_[a-f0-9]{16}$/);
  const db=getPrisma();
  try {
    const password=randomUUID()+"-Prueba!";
    const passwordHash=await hashPassword(password);
    const f=await db.$transaction(async tx=>{
      const actors:Record<string,string>={};
      for(const name of ["global","a","b","denied","expired","club"]){
        const person=await tx.people.create({data:{first_name:"Cuenta sintética",paternal_surname:name}});
        const user=await tx.users.create({data:{person_id:person.id,username:`audit-${name}`,email:`${name}@audit.example.test`,password_hash:passwordHash,must_change_password:false}});
        actors[name]=user.id;
      }
      await tx.$queryRaw`SELECT set_config('app.user_id',${actors.global},true),set_config('app.reason','Preparar bitácora sintética',true)`;
      const a=await tx.leagues.create({data:{name:"Liga A",timezone:"America/Mexico_City"}}),b=await tx.leagues.create({data:{name:"Liga B",timezone:"UTC"}});
      const ca=await tx.clubs.create({data:{name:"Club A",league_id:a.id,reference_number:randomUUID()}}),cb=await tx.clubs.create({data:{name:"Club B",league_id:b.id,reference_number:randomUUID()}});
      const permission=await tx.permissions.upsert({where:{module_action:{module:"audit",action:"READ"}},create:{module:"audit",action:"READ"},update:{}});
      const role=await tx.roles.create({data:{code:"AUDIT_SYNTHETIC_READER",name:"Consulta sintética"}});
      await tx.role_permissions.create({data:{role_id:role.id,permission_id:permission.id,context_only:false}});
      for(const name of ["global","a","b","expired","club"]){
        await tx.user_roles.create({data:{user_id:actors[name],role_id:role.id,
          league_id:name==="global"?null:name==="b"?b.id:a.id,club_id:name==="club"?ca.id:null,
          ...(name==="expired"?{starts_at:new Date("2020-01-01"),ends_at:new Date("2021-01-01")}:{}),
        }});
      }
      const update=await tx.permissions.upsert({where:{module_action:{module:"clubs",action:"UPDATE"}},create:{module:"clubs",action:"UPDATE"},update:{}});
      await tx.role_permissions.create({data:{role_id:role.id,permission_id:update.id,context_only:false}});
      const approve=await tx.permissions.upsert({where:{module_action:{module:"clubs",action:"APPROVE"}},create:{module:"clubs",action:"APPROVE"},update:{}});
      await tx.role_permissions.create({data:{role_id:role.id,permission_id:approve.id,context_only:false}});
      const ea=await tx.audit_logs.create({data:{user_id:actors.global,action:"UPDATE",table_name:"clubs",entity_id:ca.id,
        previous_data:{name:"Nombre anterior",league_id:a.id,password_hash:"NEVER_SHOW_PASSWORD",nested:{token:"NEVER_SHOW_TOKEN"}},
        new_data:{name:"Club A",league_id:a.id,curp:"NEVER_SHOW_CURP",storage_key:"NEVER_SHOW_STORAGE",email:"private@example.test"},reason:"Corrección del nombre de prueba"}});
      const eb=await tx.audit_logs.create({data:{user_id:actors.global,action:"UPDATE",table_name:"clubs",entity_id:cb.id,new_data:{league_id:b.id,status:"INACTIVE"},reason:"Cambio reservado a otra liga"}});
      const account=await tx.audit_logs.create({data:{user_id:actors.global,action:"INSERT",table_name:"users",entity_id:actors.a,new_data:{is_active:true,token_hash:"NEVER_SHOW_HASH"},reason:"Alta de cuenta sintética"}});
      const unknown=await tx.audit_logs.create({data:{user_id:actors.global,action:"UPDATE",table_name:"unregistered_source",entity_id:ca.id,new_data:{league_id:a.id},reason:"No inferir ámbito del actor"}});
      const missing=await tx.audit_logs.create({data:{user_id:actors.global,action:"UPDATE",table_name:"clubs",entity_id:randomUUID(),new_data:{league_id:a.id},reason:"Registro sin contexto comprobable"}});
      const secret=await tx.audit_logs.create({data:{user_id:actors.global,action:"UPDATE",table_name:"clubs",entity_id:ca.id,new_data:{status:"ACTIVE",league_id:a.id},reason:"api_token=NEVER_SHOW_REASON"}});
      const ambiguous=await tx.audit_logs.create({data:{user_id:actors.global,action:"UPDATE",table_name:"clubs",entity_id:ca.id,new_data:{status:"ACTIVE"},reason:"Contexto histórico no registrado"}});
      const spoof=await tx.audit_logs.create({data:{user_id:actors.global,action:"UPDATE",table_name:"clubs",entity_id:cb.id,new_data:{league_id:a.id},reason:"Contexto contradictorio"}});
      const sport=await tx.sports.findFirstOrThrow();
      const season=await tx.seasons.create({data:{league_id:a.id,sport_id:sport.id,name:"Temporada de prueba",start_date:new Date("2030-01-01"),end_date:new Date("2030-12-31")}});
      const team=await tx.teams.create({data:{club_id:ca.id,name:"Equipo A",reference_number:randomUUID()}});
      const affiliation=await tx.club_affiliations.create({data:{season_id:season.id,club_id:ca.id,league_id:a.id,reference_number:randomUUID(),uniform_colors:"Azul",status:"APPROVED",requested_by:actors.global}});
      const category=await tx.categories.create({data:{league_id:a.id,sport_id:sport.id,name:"Abierta sintética"}});
      const rule=await tx.competition_rules.create({data:{season_id:season.id,version_number:1}});
      const seasonCategory=await tx.season_categories.create({data:{season_id:season.id,category_id:category.id,competition_rule_id:rule.id,hierarchy_order:1,type:"OPEN",age_cutoff_date:new Date("2030-01-01"),competition_format:"GENERAL_TABLE",eligibility_pending:false,player_policy:{...syntheticPlayerPolicy(),registrationDays:[1,2,3,4,5,6,7]}}});
      const group=await tx.groups.create({data:{season_id:season.id,season_category_id:seasonCategory.id,name:"General"}});
      await tx.club_affiliation_categories.create({data:{affiliation_id:affiliation.id,season_id:season.id,category_id:category.id,authorized_by:actors.global,authorized_at:new Date()}});
      const enrollment=await tx.season_teams.create({data:{season_id:season.id,team_id:team.id,club_id:ca.id,season_category_id:seasonCategory.id,group_id:group.id}});
      const prefix="SIAA001010HMNLRR0",alphabet="0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
      const checksum=(10-[...prefix].reduce((sum,char,index)=>sum+alphabet.indexOf(char)*(18-index),0)%10)%10;
      const player=await tx.people.create({data:{first_name:"Jugador sintético",paternal_surname:"Prueba",curp:prefix+checksum,birth_date:new Date("2000-10-10")}});
      const registration=await tx.player_registrations.create({data:{person_id:player.id,season_id:season.id,season_team_id:enrollment.id,reference_number:randomUUID()}});
      const ep=await tx.audit_logs.create({data:{user_id:actors.global,action:"PLAYER_REGISTERED",table_name:"player_registrations",entity_id:registration.id,new_data:{status:"ACTIVE",curp:"NEVER_SHOW_PLAYER"},reason:"Alta de jugador sintético"}});
      return {actors,a,b,ca,cb,ea,eb,account,unknown,missing,ambiguous,secret,spoof,ep};
    });
    const list=(actor=f.actors.a,filters:object={})=>getAuditWorkspaceForActor(actor,{scope:f.a.id,...filters});
    await assert.rejects(list(f.actors.denied),{message:"FORBIDDEN"});
    await assert.rejects(list(f.actors.expired),{message:"FORBIDDEN"});
    await assert.rejects(list(f.actors.club),{message:"FORBIDDEN"});
    await assert.rejects(list(f.actors.a,{scope:f.b.id}),{message:"FORBIDDEN"});
    await assert.rejects(getAuditDetailForActor(f.actors.a,f.eb.id),{message:"FORBIDDEN"});
    for(const event of [f.unknown,f.missing,f.ambiguous,f.spoof])await assert.rejects(getAuditDetailForActor(f.actors.global,event.id),{message:"FORBIDDEN"});
    await assert.rejects(getAuditDetailForActor(f.actors.a,f.account.id),{message:"FORBIDDEN"});
    const detail=await getAuditDetailForActor(f.actors.a,f.ea.id);
    assert.ok(detail.changes.some(change=>change.field==="Nombre del club"));
    assert.equal((await getAuditDetailForActor(f.actors.global,f.account.id)).entity,"Cuentas");
    assert.equal((await getAuditDetailForActor(f.actors.a,f.ep.id)).entity,"Jugadores");
    const serialized=JSON.stringify([detail,await list(),await getAuditDetailForActor(f.actors.a,f.secret.id)]);
    for(const value of ["NEVER_SHOW_","password_hash","storage_key","private@example.test","previous_data","new_data"])
      assert.ok(!serialized.includes(value),`La respuesta expuso un campo reservado: ${value}`);
    assert.ok((await list(f.actors.a,{actor:"@audit-global",entity:"clubs"})).entries.every(row=>row.actor==="@audit-global" && row.entity==="Clubes"));
    await assert.rejects(list(f.actors.a,{from:"2030-02-30"}),AuditInputError);

    // Se preservan microsegundos en el cursor; insertar nuevos eventos no repite los ya consultados.
    const ids:string[]=[];
    for(let n=0;n<53;n++){
      const id=randomUUID();ids.push(id);
      await db.$executeRaw`INSERT INTO sports_management.audit_logs(id,user_id,occurred_at,action,table_name,entity_id,new_data,reason)
        VALUES(${id}::uuid,${f.actors.a}::uuid,'2030-01-02T04:30:00.123456Z'::timestamptz,'UPDATE','clubs',${f.ca.id}::uuid,jsonb_build_object('status','ACTIVE','league_id',${f.a.id}::text),'Paginación sintética')`;
    }
    let page=await list(f.actors.a,{from:"2030-01-01",to:"2030-01-01",entity:"clubs"});
    assert.equal(page.entries.length,25);
    assert.ok(page.entries[0].at.endsWith("123456Z"));
    assert.ok(page.next);
    await assert.rejects(list(f.actors.a,{after:page.next,actor:"another"}),AuditInputError);
    await db.audit_logs.create({data:{user_id:f.actors.a,occurred_at:new Date("2030-01-02T04:45:00Z"),action:"UPDATE",table_name:"clubs",entity_id:f.ca.id,new_data:{league_id:f.a.id},reason:"Nuevo evento durante navegación"}});
    const seen=page.entries.map(row=>row.id);
    while(page.next){ page=await list(f.actors.a,{from:"2030-01-01",to:"2030-01-01",entity:"clubs",after:page.next});seen.push(...page.entries.map(row=>row.id)); }
    assert.deepEqual(seen,[...ids].sort().reverse());
    assert.equal(new Set(seen).size,53);
    t.diagnostic("Filtros, hora de la liga, permisos de dos ligas y paginación con microsegundos verificados.");

    const current=await db.clubs.findUniqueOrThrow({where:{id:f.ca.id}});
    const before=await db.audit_logs.count();
    await applyClubOrTeamMaintenance(f.actors.global,{kind:"club",id:f.ca.id,version:current.version,operation:"deactivate",reason:"Baja temporal de prueba",confirmed:true});
    assert.equal(await db.audit_logs.count(),before+1);
    const rollback=Error("ROLLBACK_SINTETICO");
    await assert.rejects(db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${f.actors.global},true),set_config('app.reason','No confirmar este cambio',true)`;
      await tx.clubs.update({where:{id:f.cb.id},data:{name:"Cambio no confirmado"}});
      throw rollback;
    }),error=>error===rollback);
    assert.equal(await db.audit_logs.count(),before+1);
    assert.equal((await db.clubs.findUniqueOrThrow({where:{id:f.cb.id}})).name,"Club B");
    await assert.rejects(db.audit_logs.update({where:{id:f.ea.id},data:{reason:"Intento de modificación"}}));
    await assert.rejects(db.audit_logs.delete({where:{id:f.ea.id}}));
    assert.equal((await db.audit_logs.findUniqueOrThrow({where:{id:f.ea.id}})).reason,"Corrección del nombre de prueba");
    const role=process.env.AUDIT_TEST_ROLE??"";
    assert.match(role,/^pdgld91_reader_[a-f0-9]{16}$/);
    const adminDb=await import("pg");
    const sql=new adminDb.default.Client({connectionString:process.env.DATABASE_URL});await sql.connect();
    try {
      await sql.query(`SET ROLE "${role}"`);
      // Mismos permisos mínimos de lectura del backend; sin privilegios de propietario.
      await sql.query("SELECT id FROM sports_management.disciplinary_rulings LIMIT 1");
      await assert.rejects(sql.query("UPDATE sports_management.audit_logs SET reason='No permitido' WHERE id=$1",[f.ea.id]));
    }finally{await sql.end();}
    // La llamada con rol SQL limitado recorre la misma consulta completa.
    const limited=await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
      return getAuditWorkspaceInTransaction(tx,f.actors.a,{scope:f.a.id});
    });
    assert.ok(limited.entries.length>0 && limited.entries.every(event=>event.scope==="Liga A"));
    t.diagnostic("Operación real de mantenimiento, auditoría única, rollback e inmutabilidad verificados.");
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${f.actors.global},true),set_config('app.reason','Mover club sintético para comprobar contexto',true)`;
      await tx.clubs.update({where:{id:f.cb.id},data:{league_id:f.a.id}});
    });
    await assert.rejects(getAuditDetailForActor(f.actors.a,f.eb.id),{message:"FORBIDDEN"});
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${f.actors.global},true),set_config('app.reason','Restaurar contexto y retirar permiso sintético',true)`;
      await tx.clubs.update({where:{id:f.cb.id},data:{league_id:f.b.id}});
      await tx.user_roles.deleteMany({where:{user_id:f.actors.b}});
    });
    await assert.rejects(getAuditDetailForActor(f.actors.b,f.eb.id),{message:"FORBIDDEN"});
    if(process.env.AUDIT_HTTP_TEST==="1"){
      const auditCount=await db.audit_logs.count();
      await verifyAuditHttp(f,password);
      assert.equal(await db.audit_logs.count(),auditCount);
      t.diagnostic("Sesiones reales: lectura privada, 401/403, UUID ajeno y métodos de escritura 405 verificados.");
    }
  } finally {await db.$disconnect();}
});
