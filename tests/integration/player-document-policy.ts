import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {TestContext} from "node:test";
import type {PrismaClient} from "@prisma/client";
import {PDFDocument} from "pdf-lib";
import {syntheticDocumentPolicy,syntheticPlayerPolicy} from "../fixtures/player-document-policy";
import {configurePlayerPolicyForActor} from "../../src/features/competitions/server/player-policy";
import {AuthorizationError} from "../../src/server/auth/authorization";
import {registerPlayerForActor} from "../../src/features/players/server/service";
import {readPlayerDossierForActor} from "../../src/features/players/server/document-queries";
import {preparePlayerDocumentForActor,confirmPlayerDocumentForActor,PlayerDocumentError} from "../../src/features/players/server/document-service";
import {readDocumentReviewForActor,decideDocumentReviewForActor} from "../../src/features/players/server/document-review";
import {verifyPlayerCurpForActor} from "../../src/features/players/server/curp-verification-service";
import {activateVerifiedAdultForActor} from "../../src/features/players/server/automatic-activation";
import {validatePrivateFileContent} from "../../src/server/files/private-file-validation";
import type {CategoryDocumentPolicy} from "../../src/features/competitions/document-policy";

export async function runDocumentPolicyTests(t:TestContext,db:PrismaClient,actors:Record<string,string>,origin:{clubId:string;seasonId:string},curp:(date:string,root?:string,differentiator?:string)=>string){
  assert.equal(process.env.AUTH_TEST_RUN,"1");
  assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/pdgld48_test_[a-f0-9]{16}$/);
  const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save(),file=await validatePrivateFileContent(bytes,"application/pdf");
  const request=()=>({operationKey:randomUUID(),identityVersion:1,confirmCharge:true});
  const provider={configured:true,verify:async()=>({status:"VERIFIED" as const,mismatchedFields:[]})};
  const limits={globalDailyLimit:1000,actorDailyLimit:1000,cooldownMs:0};
  const cases: {teamId:string;categoryId:string}[]=[];
  async function fixture(documents:CategoryDocumentPolicy,type="OPEN",maximumAge:number|null=null){
    return db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Preparación explícita de datos sintéticos de política documental',true)`;
      const season=await tx.seasons.findUniqueOrThrow({where:{id:origin.seasonId}});
      const rule=await tx.competition_rules.findFirstOrThrow({where:{season_id:origin.seasonId},select:{id:true}});
      const category=await tx.categories.create({data:{league_id:season.league_id,sport_id:season.sport_id,name:`Política sintética ${randomUUID()}`}});
      const sc=await tx.season_categories.create({data:{season_id:season.id,category_id:category.id,competition_rule_id:rule.id,type,hierarchy_order:100+cases.length,minimum_age:0,maximum_age:maximumAge,age_cutoff_date:new Date('2026-12-31'),eligibility_pending:false,player_policy:{...syntheticPlayerPolicy(documents),maximumAge}}});
      await tx.club_affiliation_categories.create({data:{affiliation_id:(await tx.club_affiliations.findUniqueOrThrow({where:{club_id_season_id:{club_id:origin.clubId,season_id:origin.seasonId}}})).id,season_id:season.id,category_id:category.id,authorized_by:actors.admin,authorized_at:new Date()}});
      const group=await tx.groups.create({data:{season_id:season.id,season_category_id:sc.id,name:'Grupo de política sintética'}});
      const team=await tx.teams.create({data:{club_id:origin.clubId,name:`Equipo documental ${cases.length}`,reference_number:`doc-policy-${randomUUID()}`}});
      const st=await tx.season_teams.create({data:{season_id:season.id,club_id:origin.clubId,team_id:team.id,group_id:group.id}});
      const result={teamId:st.id,categoryId:sc.id};cases.push(result);return result;
    });
  }
  async function register(context:{teamId:string},dob:string){return registerPlayerForActor(actors.delegate,{seasonTeamId:context.teamId,identity:{curp:curp(dob,'DOCA',Number(dob.slice(0,4))>=2000?'A':'0'),birthDate:dob,firstName:'PruebaDocumental',paternalSurname:'Caso',maternalSurname:'Sintetico'}});}
  async function prepare(id:string,code:string){
    const dossier=await readPlayerDossierForActor(actors.delegate,id),type=dossier.documentTypes.find(d=>d.code===code)!;
    assert.ok(type,`Tipo solicitado disponible: ${code}`);
    const requirement=dossier.requirements.find(r=>r.typeId===type.id)!;
    const policy={referenceDate:dossier.referenceDate,window:'PENDING_DOSSIER_V1' as const};
    const payload={operationKey:randomUUID(),registrationId:id,requirementId:requirement.id,slot:1,replacesDocumentId:null,mimeType:file.mimeType,sizeBytes:file.sizeBytes,sha256:file.sha256};
    return {prepared:await preparePlayerDocumentForActor(actors.delegate,payload,policy),payload,policy};
  }
  async function receive(id:string,code:string){const data=await prepare(id,code);const result=await confirmPlayerDocumentForActor(actors.delegate,data.prepared.uploadId,{read:async()=>bytes},data.policy);return {...data,...result};}
  async function approve(id:string,documentId:string){const state=await readDocumentReviewForActor(actors.secretary,id);return decideDocumentReviewForActor(actors.secretary,id,{operationKey:randomUUID(),fingerprint:state.fingerprint,documentId,decision:'APPROVE',reason:'Documento sintético revisado en PostgreSQL aislado',identityChecked:false,relationshipChecked:false,signatureChecked:false,authorizationChecked:false});}

  await t.test('Política documental: configuración autorizada/versionada y bloqueo con inscripciones por grupo',async()=>{
    const context=await fixture(syntheticDocumentPolicy());
    const version=(await db.seasons.findUniqueOrThrow({where:{id:origin.seasonId}})).version;
    const input={expectedSeasonVersion:version,reason:'Política explícita sintética; no válida para uso real',policy:syntheticPlayerPolicy()};
    await assert.rejects(configurePlayerPolicyForActor(actors.delegate,origin.seasonId,context.categoryId,input),e=>e instanceof AuthorizationError);
    await configurePlayerPolicyForActor(actors.admin,origin.seasonId,context.categoryId,input);
    await assert.rejects(configurePlayerPolicyForActor(actors.admin,origin.seasonId,context.categoryId,input));
    await register(context,'1983-02-03');
    await assert.rejects(configurePlayerPolicyForActor(actors.admin,origin.seasonId,context.categoryId,{...input,expectedSeasonVersion:version+1}),e=>String(e).includes('PLAYER_POLICY_IN_USE'));
  });
  await t.test('Política documental: adulto se habilita con CURP verificada solo por excepción explícita; constancia pendiente',async()=>{
    const context=await fixture(syntheticDocumentPolicy()),registered=await register(context,'1982-03-04');
    let calls=0;
    const result=await verifyPlayerCurpForActor(actors.delegate,registered.registrationId,request(),{provider:{...provider,verify:async()=>{calls++;return provider.verify();}},policy:limits});
    assert.equal(result.registrationStatus,'ACTIVE');assert.equal(calls,1);
    const dossier=await readPlayerDossierForActor(actors.delegate,registered.registrationId);
    assert.equal(dossier.dossierComplete,false);assert.equal(dossier.eligibilityDocumentsComplete,true);assert.equal(dossier.documentPolicyApproved,true);
    assert.equal(dossier.documentGroups.find(g=>g.key==='CURP')?.requiredForDossier,true);
    assert.equal(dossier.documentGroups.find(g=>g.key==='CURP')?.requiredForEligibility,false);
    assert.equal(dossier.documentGroups.find(g=>g.key==='PHOTO_IDENTIFICATION')?.requiredForEligibility,false);
    const license=await receive(registered.registrationId,'DRIVER_LICENSE');
    assert.equal((await preparePlayerDocumentForActor(actors.delegate,license.payload,license.policy)).uploadId,license.prepared.uploadId);
    assert.equal((await confirmPlayerDocumentForActor(actors.delegate,license.prepared.uploadId,{read:async()=>{throw Error('No debe leer Storage al recuperar acuse');}},license.policy)).replayed,true);
    assert.equal((await readPlayerDossierForActor(actors.delegate,registered.registrationId)).dossierComplete,false);
    const event=await db.audit_logs.findFirstOrThrow({where:{entity_id:registered.registrationId,action:'PLAYER_AUTO_ACTIVATED'},select:{new_data:true}});
    assert.ok((event.new_data as {documentPolicyFingerprint:string}).documentPolicyFingerprint);
    const changed=syntheticDocumentPolicy();changed.requirements.find(r=>r.key==='PHOTO_IDENTIFICATION')!.requiredForDossier=true;
    await assert.rejects(configurePlayerPolicyForActor(actors.admin,origin.seasonId,context.categoryId,{expectedSeasonVersion:(await db.seasons.findUniqueOrThrow({where:{id:origin.seasonId}})).version,reason:'No alterar retroactivamente a un jugador ya habilitado',policy:syntheticPlayerPolicy(changed)}),e=>String(e).includes('PLAYER_POLICY_IN_USE'));
  });
  await t.test('Política documental: requisito obligatorio no se omite; pasaporte recibido no equivale a aprobado',async()=>{
    const policy=syntheticDocumentPolicy();const identification=policy.requirements.find(r=>r.key==='PHOTO_IDENTIFICATION')!;identification.requiredForDossier=true;identification.requiredForEligibility=true;
    const context=await fixture(policy),registered=await register(context,'1981-04-05');let calls=0;
    const result=await verifyPlayerCurpForActor(actors.delegate,registered.registrationId,request(),{provider:{...provider,verify:async()=>{calls++;return provider.verify();}},policy:limits});
    assert.equal(result.registrationStatus,'INELIGIBLE');
    const passport=await receive(registered.registrationId,'PASSPORT');
    await activateVerifiedAdultForActor(actors.delegate,registered.registrationId);
    assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:registered.registrationId}})).status,'INELIGIBLE');
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Restricción deportiva sintética durante aprobación documental',true)`;
      const type=await tx.sanction_types.findUniqueOrThrow({where:{code:'TIME'}});
      const rule=await tx.competition_rules.findFirstOrThrow({where:{season_id:origin.seasonId},select:{id:true}});
      const article=await tx.regulation_articles.create({data:{competition_rule_id:rule.id,number:`DOC-${randomUUID()}`,description:'Sanción sintética de prueba',sanction_type_id:type.id}});
      const record=await tx.disciplinary_cases.create({data:{season_id:origin.seasonId,reference_number:`DOC-${randomUUID()}`,opened_by:actors.admin,description:'Caso sintético documental'}});
      const ruling=await tx.disciplinary_rulings.create({data:{case_id:record.id,version_number:1,decided_by:actors.admin,decision:'Restricción sintética',reason:'Prueba de límites de habilitación'}});
      return tx.sanctions.create({data:{ruling_id:ruling.id,article_id:article.id,sanction_type_id:type.id,registration_id:registered.registrationId,blocks_participation:true,starts_at:new Date('2026-10-25T00:00:00Z'),ends_at:new Date('2026-10-27T00:00:00Z')},select:{id:true}});
    });
    const [clock]=await db.$queryRaw<{definition:string}[]>`SELECT pg_get_functiondef('sports_management.player_participation_now()'::regprocedure) AS definition`;
    try{
      // Solo el reloj de esta BD desechable avanza; sanctions sigue inmutable.
      await db.$executeRawUnsafe("CREATE OR REPLACE FUNCTION sports_management.player_participation_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT '2026-10-26T12:00:00-06:00'::timestamptz$$");
      await approve(registered.registrationId,passport.documentId);
      assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:registered.registrationId}})).status,'INELIGIBLE','Un documento aprobado no elude una sanción vigente');
      await db.$executeRawUnsafe("CREATE OR REPLACE FUNCTION sports_management.player_participation_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT '2026-10-28T12:00:00-06:00'::timestamptz$$");
      await activateVerifiedAdultForActor(actors.delegate,registered.registrationId);
    }finally{await db.$executeRawUnsafe(clock.definition);}
    assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:registered.registrationId}})).status,'ACTIVE');
    assert.equal(calls,1,'Revisar un archivo reevalúa localmente, sin otra consulta de CURP');
    const dossier=await readPlayerDossierForActor(actors.delegate,registered.registrationId);
    assert.equal(dossier.documentGroups.find(g=>g.key==='PHOTO_IDENTIFICATION')?.ready,true);
    assert.equal(dossier.dossierComplete,false,'Aún se pide la constancia CURP para completar el expediente');
    const curpFile=await receive(registered.registrationId,'CURP');await approve(registered.registrationId,curpFile.documentId);
    assert.equal((await readPlayerDossierForActor(actors.delegate,registered.registrationId)).dossierComplete,true);
  });
  await t.test('Política documental: menor requiere alternativa escolar y tutor acreditado; nacimiento sin comprobantes sigue pendiente',async()=>{
    const policy=syntheticDocumentPolicy();policy.profile='CHILDREN';policy.status='DRAFT';policy.pendingDecisions=['BIRTH_EVIDENCE_TYPES'];policy.requirements.push({key:'BIRTH_EVIDENCE',audience:'ALL',anyOf:[],quantity:1,requiredForDossier:true,requiredForEligibility:true});
    const context=await fixture(policy,'YOUTH',17),registered=await register(context,'2010-05-06');
    const certificate=await receive(registered.registrationId,'STUDENT_CERTIFICATE');await approve(registered.registrationId,certificate.documentId);
    const dossier=await readPlayerDossierForActor(actors.delegate,registered.registrationId);
    assert.equal(dossier.school.approved,true);assert.equal(dossier.guardianConsent,'REQUIRES_ACCREDITATION');
    assert.ok(dossier.configurationIssues.includes('BIRTH_EVIDENCE_TYPES'));
    assert.equal(dossier.documentTypes.some(d=>d.code==='BIRTH_CERTIFICATE'),false,'No se impone un acta por defecto');
    assert.equal(dossier.dossierComplete,false);assert.equal(dossier.eligibilityDocumentsComplete,false);
    await assert.rejects(preparePlayerDocumentForActor(actors.other,certificate.payload,certificate.policy),e=>e instanceof AuthorizationError);
    // Decisión exclusiva de este fixture; no se adopta CURP como comprobante
    // de nacimiento en las categorías reales de la liga.
    policy.status='APPROVED';policy.pendingDecisions=[];policy.requirements.find(r=>r.key==='BIRTH_EVIDENCE')!.anyOf=['CURP'];
    await configurePlayerPolicyForActor(actors.admin,origin.seasonId,context.categoryId,{expectedSeasonVersion:(await db.seasons.findUniqueOrThrow({where:{id:origin.seasonId}})).version,reason:'Comprobante de nacimiento ficticio aprobado solo en prueba aislada',policy:{...syntheticPlayerPolicy(policy),maximumAge:17}});
    const resolved=await readPlayerDossierForActor(actors.delegate,registered.registrationId);
    assert.equal(resolved.documentPolicyApproved,true);assert.equal(resolved.eligibilityDocumentsComplete,false);
    assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:registered.registrationId}})).status,'INELIGIBLE');
  });
  await t.test('Política documental: confirmación reautoriza y rechaza una intención preparada con otra versión de política',async()=>{
    const context=await fixture(syntheticDocumentPolicy()),registered=await register(context,'1980-06-07');
    const pending=await prepare(registered.registrationId,'PASSPORT');
    const changed=syntheticDocumentPolicy();changed.status='DRAFT';changed.pendingDecisions=['ADULT_SIGNATURE_SCOPE'];
    let reads=0;
    await assert.rejects(confirmPlayerDocumentForActor(actors.delegate,pending.prepared.uploadId,{read:async()=>{
      reads++;
      // Cambia la política entre la autorización inicial y la confirmación final.
      await configurePlayerPolicyForActor(actors.admin,origin.seasonId,context.categoryId,{expectedSeasonVersion:(await db.seasons.findUniqueOrThrow({where:{id:origin.seasonId}})).version,reason:'Cambio documental controlado durante intención pendiente',policy:syntheticPlayerPolicy(changed)});
      return bytes;
    }},pending.policy),e=>e instanceof PlayerDocumentError && e.code==='UPLOAD_CONFLICT');
    assert.equal(reads,1);
    assert.equal(await db.player_documents.count({where:{registration_id:registered.registrationId}}),0);
    await verifyPlayerCurpForActor(actors.delegate,registered.registrationId,request(),{provider,policy:limits});
    assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:registered.registrationId}})).status,'INELIGIBLE');
  });
}
