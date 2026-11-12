import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {TestContext} from "node:test";
import type {PrismaClient} from "@prisma/client";
import {PDFDocument} from "pdf-lib";
import {syntheticDocumentPolicy} from "../fixtures/player-document-policy";
import {readPlayerParticipationWorkspaceForActor} from "../../src/features/players/server/participation-workspace-queries";
import {reviewCategoryParticipationForActor,CategoryParticipationError,readCategoryParticipationsForActor} from "../../src/features/players/server/category-participations";
import {approvePlayerOriginForActor} from "../../src/features/players/server/origin-approval";
import {verifyPlayerCurpForActor} from "../../src/features/players/server/curp-verification-service";
import {readPlayerDossierForActor} from "../../src/features/players/server/document-queries";
import {preparePlayerDocumentForActor,confirmPlayerDocumentForActor} from "../../src/features/players/server/document-service";
import {readDocumentReviewForActor,decideDocumentReviewForActor} from "../../src/features/players/server/document-review";
import {validatePrivateFileContent} from "../../src/server/files/private-file-validation";
import {AuthorizationError} from "../../src/server/auth/authorization";
import {runMatchEligibilityTests} from "./match-eligibility";

export async function runParticipationEligibilityTests(t:TestContext,db:PrismaClient,actors:Record<string,string>,originId:string,sourceCategory:string,targetCategory:string){
  assert.equal(process.env.AUTH_TEST_RUN,"1");assert.match(new URL(process.env.DATABASE_URL!).pathname,/^\/pdgld48_test_[a-f0-9]{16}$/);
  const reason="Revisión explícita exclusivamente con evidencia sintética",pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save(),file=await validatePrivateFileContent(bytes,"application/pdf");
  let providerCalls=0,participationId="";
  const state=()=>readPlayerParticipationWorkspaceForActor(actors.admin,originId);
  const isCode=(code:string)=>(e:unknown)=>e instanceof CategoryParticipationError && e.code===code;
  async function document(code:string){
    const dossier=await readPlayerDossierForActor(actors.delegate,originId),type=dossier.documentTypes.find(d=>d.code===code)!;
    assert.ok(type,`El único expediente ofrece ${code}`);const r=dossier.requirements.find(r=>r.typeId===type.id)!;
    const policy={referenceDate:dossier.referenceDate,window:"PENDING_DOSSIER_V1" as const};
    const prepared=await preparePlayerDocumentForActor(actors.delegate,{operationKey:randomUUID(),registrationId:originId,requirementId:r.id,slot:1,replacesDocumentId:null,mimeType:file.mimeType,sizeBytes:file.sizeBytes,sha256:file.sha256},policy);
    const received=await confirmPlayerDocumentForActor(actors.delegate,prepared.uploadId,{read:async()=>bytes},policy);
    const review=await readDocumentReviewForActor(actors.admin,originId);
    return {received,approve:()=>decideDocumentReviewForActor(actors.admin,originId,{operationKey:randomUUID(),fingerprint:review.fingerprint,documentId:received.documentId,decision:"APPROVE",reason,identityChecked:false,relationshipChecked:false,signatureChecked:false,authorizationChecked:false})};
  }
  const reviewBody=(s:Awaited<ReturnType<typeof state>>,decision="AUTHORIZE")=>({operationKey:randomUUID(),expectedVersion:s.participations[0].version,fingerprint:s.participations[0].assessment!.fingerprint,decision,reason});

  await t.test("Entrega 3: origen exige CURP vigente y documento aprobado; aprobación administrativa idempotente y autorizada",async()=>{
    for(const [id,target]of[[sourceCategory,false],[targetCategory,true]] as const){
      const c=await db.season_categories.findUniqueOrThrow({where:{id}}),docs=syntheticDocumentPolicy();
      docs.activation="ADMINISTRATIVE";docs.requirements.find(r=>r.key==="CURP"&&r.audience==="ADULTS")!.requiredForEligibility=true;
      if(target){const r=docs.requirements.find(r=>r.key==="PHOTO_IDENTIFICATION")!;r.anyOf=["PASSPORT"];r.requiredForDossier=true;r.requiredForEligibility=true;}
      await db.season_categories.update({where:{id},data:{player_policy:{...(c.player_policy as object),documents:docs}}});
    }
    const verified=await verifyPlayerCurpForActor(actors.delegate,originId,{operationKey:randomUUID(),identityVersion:1,confirmCharge:true},{provider:{configured:true,verify:async()=>{providerCalls++;return{status:"VERIFIED" as const,mismatchedFields:[]};}},policy:{globalDailyLimit:1000,actorDailyLimit:1000,cooldownMs:0}});
    assert.equal(verified.registrationStatus,"INELIGIBLE");
    let s=await state();participationId=s.participations[0].id;
    assert.ok(s.source.assessment);
    assert.ok(s.source.assessment.blockers.some(b=>b.code==="DOCUMENT_CURP"));
    const curp=await document("CURP");const received=await state();assert.ok(received.source.assessment);assert.equal(received.source.assessment.ready,false,"Recibir no equivale a aprobar");await curp.approve();
    s=await state();assert.ok(s.source.assessment);assert.equal(s.source.assessment.ready,true,JSON.stringify(s.source.assessment.blockers));
    const payload={operationKey:randomUUID(),fingerprint:s.source.assessment.fingerprint,reason};
    await assert.rejects(approvePlayerOriginForActor(actors.delegate,originId,payload),e=>e instanceof AuthorizationError);
    await assert.rejects(approvePlayerOriginForActor(actors.other,originId,payload),e=>e instanceof AuthorizationError);
    const replies=await Promise.all([approvePlayerOriginForActor(actors.admin,originId,payload),approvePlayerOriginForActor(actors.admin,originId,payload)]);
    assert.deepEqual(replies.map(r=>r.replayed).sort(),[false,true]);assert.equal(replies[0].status,"ACTIVE");
    assert.equal(await db.audit_logs.count({where:{entity_id:originId,action:"PLAYER_MANUAL_ACTIVATED"}}),1);
  });
  await t.test("Entrega 3: destino exige sus propios documentos; permisos, concurrencia y versión conservan origen",async()=>{
    let s=await state();assert.equal(s.participations[0].assessment!.ready,false);
    await assert.rejects(reviewCategoryParticipationForActor(actors.admin,participationId,reviewBody(s)),isCode("ELIGIBILITY_NOT_READY"));
    const dossier=await readPlayerDossierForActor(actors.delegate,originId);
    assert.equal(dossier.originDossierComplete,true);assert.equal(dossier.dossierComplete,false);assert.equal(dossier.canUpload,true);
    assert.ok(dossier.documentGroups.some(g=>g.scope==="SUPERIOR" && g.key==="PHOTO_IDENTIFICATION" && !g.ready));
    const passport=await document("PASSPORT");await passport.approve();s=await state();
    assert.equal(s.participations[0].assessment!.ready,true,JSON.stringify(s.participations[0].assessment!.blockers));
    const before=await db.player_registrations.findUniqueOrThrow({where:{id:originId}}),payload=reviewBody(s);
    await assert.rejects(reviewCategoryParticipationForActor(actors.delegate,participationId,payload),e=>e instanceof AuthorizationError);
    await assert.rejects(reviewCategoryParticipationForActor(actors.other,participationId,payload),e=>e instanceof AuthorizationError);
    const replies=await Promise.all([reviewCategoryParticipationForActor(actors.admin,participationId,payload),reviewCategoryParticipationForActor(actors.admin,participationId,payload)]);
    assert.ok(replies.every(r=>r.status==="AUTHORIZED" && r.version===2 && r.sportsEligible));assert.deepEqual(replies.map(r=>r.replayed).sort(),[false,true]);
    await assert.rejects(reviewCategoryParticipationForActor(actors.admin,participationId,{...payload,operationKey:randomUUID()}),isCode("STALE_ELIGIBILITY"));
    await assert.rejects(reviewCategoryParticipationForActor(actors.admin,participationId,{...payload,reason:"Otro contenido para la misma operación"}),isCode("PARTICIPATION_CONFLICT"));
    assert.deepEqual(await db.player_registrations.findUniqueOrThrow({where:{id:originId}}),before);
    assert.equal(await db.player_registrations.count({where:{person_id:before.person_id,season_id:before.season_id}}),1);
    assert.equal(await db.audit_logs.count({where:{entity_id:participationId,action:"PLAYER_PARTICIPATION_REVIEWED"}}),1);
  });
  if(process.env.MATCH_ELIGIBILITY_TEST_PORT)await runMatchEligibilityTests(t,db,actors,originId);
  await t.test("Entrega 3: SQL protege solicitudes y acuses; baja temporal, retiro y cambio de identidad invalidan vigencia",async()=>{
    const row=await db.player_category_participations.findUniqueOrThrow({where:{id:participationId}});
    await assert.rejects(db.player_category_participations.update({where:{id:row.id},data:{status:"WITHDRAWN",version:3}}),/PLAYER_PARTICIPATION_IMMUTABLE/);
    await assert.rejects(db.player_category_participations.delete({where:{id:row.id}}),/PLAYER_PARTICIPATION_IMMUTABLE/);
    await assert.rejects(db.player_category_participations.create({data:{...row,id:randomUUID(),request_key:randomUUID()}}),/PLAYER_PARTICIPATION_IMMUTABLE/);
    const target=await db.season_teams.findUniqueOrThrow({where:{id:row.target_season_team_id}});
    for(const status of["INACTIVE","ACTIVE"]){await db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason',${reason},true)`;await tx.teams.update({where:{id:target.team_id},data:{status,version:{increment:1}}});});assert.equal((await readCategoryParticipationsForActor(actors.delegate,originId))[0].sportsEligible,status==="ACTIVE");}
    let s=await state();const withdrawn=await reviewCategoryParticipationForActor(actors.admin,participationId,reviewBody(s,"WITHDRAW"));assert.equal(withdrawn.sportsEligible,false);assert.equal(withdrawn.status,"WITHDRAWN");
    s=await state();assert.equal((await reviewCategoryParticipationForActor(actors.admin,participationId,reviewBody(s))).sportsEligible,true);
    const pr=await db.player_registrations.findUniqueOrThrow({where:{id:originId}});await db.people.update({where:{id:pr.person_id},data:{maternal_surname:"Identidad cambiada"}});
    const before=await db.audit_logs.count({where:{entity_id:participationId}});s=await state();assert.equal(s.participations[0].sportsEligible,false);assert.ok(s.participations[0].assessment!.blockers.some(b=>b.code==="CURP_NOT_VERIFIED"));assert.equal(await db.audit_logs.count({where:{entity_id:participationId}}),before,"Consultar no toma decisiones ni modifica estados");
    assert.equal(providerCalls,1,"Solo un transporte simulado; revisar y reintentar no consume créditos");
  });
}
