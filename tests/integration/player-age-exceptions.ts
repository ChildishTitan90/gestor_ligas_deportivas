import assert from "node:assert/strict";
import {requestIdentityCorrectionForActor,decideIdentityCorrectionForActor} from "../../src/features/players/server/identity-correction";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import { syntheticPlayerPolicy, syntheticDocumentPolicy } from "../fixtures/player-document-policy";
import { registerPlayerForActor } from "../../src/features/players/server/service";
import { registerAndVerifyPlayerForActor } from "../../src/features/players/server/registration-intake";
import { PlayerRegistrationError } from "../../src/features/players/server/access";
import { AuthorizationError, lockAuthorization } from "../../src/server/auth/authorization";
import { readPlayerDossierForActor } from "../../src/features/players/server/document-queries";
import { preparePlayerDocumentForActor, confirmPlayerDocumentForActor } from "../../src/features/players/server/document-service";
import { readAgeExceptionForActor, actOnAgeExceptionForActor, recoverAgeExceptionForActor } from "../../src/features/players/server/age-exception-service";
import { readAgeExceptionRecord } from "../../src/features/players/server/age-exception-record";
import { validatePrivateFileContent } from "../../src/server/files/private-file-validation";
import { readPlayerParticipationWorkspaceForActor } from "../../src/features/players/server/participation-workspace-queries";

export async function runAgeExceptionTests(t: TestContext, db: PrismaClient, actors: Record<string, string>,
  origin: { clubId: string; seasonId: string }, curp: (dob: string, root?: string, differentiator?: string) => string,
  setClock: (timestamp: string) => Promise<void>) {
  assert.equal(process.env.AUTH_TEST_RUN, "1");
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const suffix = randomUUID();
  const fixture = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','PDGLD-104: categoría sintética para pruebas de excepción',true)`;
    const club = await tx.clubs.findUniqueOrThrow({ where: { id: origin.clubId } });
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: origin.seasonId } });
    const rule = await tx.competition_rules.findFirstOrThrow({ where: { season_id: season.id } });
    const category = await tx.categories.create({ data: { league_id: club.league_id, sport_id: season.sport_id, name: `Sub sintética P104 ${suffix}` } });
    const documents = { ...syntheticDocumentPolicy(), profile: "YOUTH" as const, activation: "ADMINISTRATIVE" as const,
      requirements:syntheticDocumentPolicy().requirements.map(rule=>rule.key==="CURP"?{...rule,requiredForEligibility:true}:rule) };
    const policy = { ...syntheticPlayerPolicy(documents), minimumAge: 14, maximumAge: 16, exceptionMinimumAge: 13 };
    const sc = await tx.season_categories.create({ data: { season_id: season.id, category_id: category.id, competition_rule_id: rule.id,
      type: "YOUTH", hierarchy_order: 904, eligibility_pending: false, minimum_age: 14, maximum_age: 16,
      age_cutoff_date: new Date("2026-12-31"), player_policy: policy } });
    const group = await tx.groups.create({ data: { season_id: season.id, season_category_id: sc.id, name: "Grupo P104" } });
    await tx.club_affiliation_categories.create({ data: { affiliation_id: (await tx.club_affiliations.findFirstOrThrow({ where: { club_id: club.id, season_id: season.id } })).id,
      season_id: season.id, category_id: category.id, authorized_by: actors.admin, authorized_at: new Date() } });
    const team = await tx.teams.create({ data: { club_id: club.id, name: "Equipo P104", reference_number: `P104-${suffix}` } });
    const st = await tx.season_teams.create({ data: { club_id: club.id, team_id: team.id, season_id: season.id, group_id: group.id } });
    return { teamId: st.id, categoryId: sc.id };
  });
  let serial = 0;
  function payload(dob = `2013-02-${String(++serial * 2).padStart(2, "0")}`) {
    return { seasonTeamId: fixture.teamId, requestAgeException: true,
      identity: { curp: curp(dob, "XEAA", Number(dob.slice(0, 4)) >= 2000 ? "A" : "0"), birthDate: dob,
        firstName: "Caso", paternalSurname: "Excepcion", maternalSurname: "Sintetico" } };
  }
  const pdf = await PDFDocument.create(); pdf.addPage();
  const file = await validatePrivateFileContent(await pdf.save(), "application/pdf");
  async function attach(id: string, replacesDocumentId: string | null = null) {
    const dossier = await readPlayerDossierForActor(actors.delegate, id);
    const type = dossier.documentTypes.find(d => d.code === "AGE_EXCEPTION_LETTER")!;
    assert.ok(type, "El expediente excepcional ofrece su carta específica");
    const requirement = dossier.requirements.find(r => r.typeId === type.id)!;
    const intent = await preparePlayerDocumentForActor(actors.delegate, { operationKey: randomUUID(), registrationId: id,
      requirementId: requirement.id, slot: 1, replacesDocumentId, mimeType: file.mimeType, sizeBytes: file.sizeBytes, sha256: file.sha256 },
    { referenceDate: dossier.referenceDate, window: "PENDING_DOSSIER_V1" });
    return confirmPlayerDocumentForActor(actors.delegate, intent.uploadId, { read: async () => file.bytes },
      { referenceDate: dossier.referenceDate, window: "PENDING_DOSSIER_V1" });
  }
  async function ready() {
    const reg = await registerPlayerForActor(actors.delegate, payload());
    await attach(reg.registrationId);
    const state = await readAgeExceptionForActor(actors.delegate, reg.registrationId);
    const body = { action: "REQUEST", operationKey: randomUUID(), fingerprint: state.fingerprint, documentId: state.documentId, reason: "Petición sintética con carta" } as const;
    await actOnAgeExceptionForActor(actors.delegate, reg.registrationId, body);
    return { reg, body };
  }
  await setClock("2026-10-26T18:00:00Z");
  await t.test("PDGLD-104: captura explícita conserva bloqueo, exige margen y no consulta CURP", async () => {
    const input = payload();
    await assert.rejects(registerPlayerForActor(actors.delegate, { ...input, requestAgeException: false }), e => e instanceof PlayerRegistrationError && e.code === "AGE_EXCEPTION_REQUIRED");
    let calls = 0;
    const reg = await registerAndVerifyPlayerForActor(actors.delegate, input, { provider: { configured: true, verify: async () => { calls++; throw Error("No debe llamar"); } } });
    assert.equal(calls, 0); assert.equal(reg.ageExceptionPending, true); assert.equal(reg.status, "INELIGIBLE");
    const replay = await registerPlayerForActor(actors.delegate, input); assert.equal(replay.registrationId, reg.registrationId);
    await assert.rejects(registerPlayerForActor(actors.delegate, payload("2014-01-03")), e => e instanceof PlayerRegistrationError && e.code === "AGE_EXCEPTION_NOT_APPLICABLE");
    await setClock("2026-10-31T18:00:00Z");
    try { await assert.rejects(registerPlayerForActor(actors.delegate, payload()), e => e instanceof PlayerRegistrationError && e.code === "REGISTRATION_WINDOW_CLOSED"); }
    finally { await setClock("2026-10-26T18:00:00Z"); }
  });
  await t.test("PDGLD-104: petición exige carta propia confirmada y motivo; el tutor no la sustituye", async () => {
    const reg = await registerPlayerForActor(actors.delegate, payload());
    const state = await readAgeExceptionForActor(actors.delegate, reg.registrationId);
    await assert.rejects(actOnAgeExceptionForActor(actors.delegate, reg.registrationId, { action: "REQUEST", operationKey: randomUUID(), fingerprint: state.fingerprint, documentId: randomUUID(), reason: "Motivo" }),
      e => e instanceof PlayerRegistrationError && e.code === "AGE_EXCEPTION_DOCUMENT_REQUIRED");
    assert.notEqual((await readAgeExceptionForActor(actors.delegate, reg.registrationId)).status, "APPROVED");
    await attach(reg.registrationId);
    const current = await readAgeExceptionForActor(actors.delegate, reg.registrationId);
    for (const reason of ["", "   "]) await assert.rejects(actOnAgeExceptionForActor(actors.delegate, reg.registrationId,
      { action: "REQUEST", operationKey: randomUUID(), fingerprint: current.fingerprint, documentId: current.documentId, reason }), e => e instanceof PlayerRegistrationError && e.code === "VALIDATION_ERROR");
    await assert.rejects(readAgeExceptionForActor(actors.other, reg.registrationId), e => e instanceof AuthorizationError);
  });
  let acceptedId: string;
  await t.test("PDGLD-104: solo Secretaría con APPROVE del contexto acepta; el acuse es idempotente", async () => {
    const { reg } = await ready(); acceptedId = reg.registrationId;
    const state = await readAgeExceptionForActor(actors.secretary, reg.registrationId);
    const body = { action: "DECIDE", decision: "APPROVE", requestId: state.requestId, fingerprint: state.fingerprint, operationKey: randomUUID(), reason: "Secretaría acepta la carta sintética" } as const;
    for (const actor of [actors.delegate, actors.other, actors.admin]) await assert.rejects(actOnAgeExceptionForActor(actor, reg.registrationId, body), e => e instanceof AuthorizationError);
    const first = await actOnAgeExceptionForActor(actors.secretary, reg.registrationId, body);
    const replay = await actOnAgeExceptionForActor(actors.secretary, reg.registrationId, body);
    assert.equal(first.replayed, false); assert.equal(replay.replayed, true);
    const recovery = await recoverAgeExceptionForActor(actors.secretary, reg.registrationId, body.operationKey); assert.equal(recovery.confirmed, true);
    assert.equal((await readAgeExceptionForActor(actors.secretary, reg.registrationId)).status, "APPROVED");
    const stored = await db.player_registrations.findUniqueOrThrow({ where: { id: reg.registrationId } });
    assert.equal(stored.authorized_by, actors.secretary); assert.equal(stored.status, "INELIGIBLE");
    const workspace = await readPlayerParticipationWorkspaceForActor(actors.secretary, reg.registrationId);
    assert.ok(workspace.source.assessment);
    assert.ok(!workspace.source.assessment.blockers.some(b => b.code === "AGE_REQUIRES_REVIEW"));
    assert.equal(workspace.source.assessment.ready, false, "Los demás requisitos siguen pendientes");
    assert.equal(await db.audit_logs.count({ where: { entity_id: reg.registrationId, action: "PLAYER_AGE_EXCEPTION_DECIDED" } }), 1);
  });
  await t.test("PDGLD-104: reemplazar la carta invalida la aceptación y conserva su historial", async () => {
    const before = await readAgeExceptionForActor(actors.delegate, acceptedId!);
    await attach(acceptedId!, before.documentId);
    const after = await readAgeExceptionForActor(actors.delegate, acceptedId!);
    assert.equal(after.status, "STALE");
    const record = await db.$transaction(tx => readAgeExceptionRecord(tx, acceptedId!, fixture.categoryId)); assert.equal(record.validApproval, false);
    assert.equal(await db.audit_logs.count({ where: { entity_id: acceptedId!, action: "PLAYER_AGE_EXCEPTION_DECIDED" } }), 1);
  });
  await t.test("PDGLD-104: decisiones concurrentes tienen un ganador; el rechazo no habilita", async () => {
    const { reg } = await ready();
    const state = await readAgeExceptionForActor(actors.secretary, reg.registrationId);
    const body = { action: "DECIDE", decision: "REJECT", requestId: state.requestId, fingerprint: state.fingerprint, reason: "Carta rechazada en prueba sintética" } as const;
    const results = await Promise.allSettled([1, 2].map(() => actOnAgeExceptionForActor(actors.secretary, reg.registrationId, { ...body, operationKey: randomUUID() })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await readAgeExceptionForActor(actors.delegate, reg.registrationId)).status, "REJECTED");
    const stored = await db.player_registrations.findUniqueOrThrow({ where: { id: reg.registrationId } });
    assert.equal(stored.status, "INELIGIBLE"); assert.equal(stored.authorized_by, null);
  });
  await t.test("PDGLD-104: revocar APPROVE impide decidir o recuperar con la misma cuenta", async () => {
    const { reg } = await ready();
    const state = await readAgeExceptionForActor(actors.secretary, reg.registrationId);
    const role = await db.roles.findUniqueOrThrow({ where: { code: "SECRETARY" } });
    const permission = await db.permissions.findUniqueOrThrow({ where: { module_action: { module: "players", action: "APPROVE" } } });
    const where = { role_id_permission_id: { role_id: role.id, permission_id: permission.id } };
    const grant = await db.role_permissions.findUniqueOrThrow({ where });
    const command = {action:"DECIDE",decision:"REJECT",requestId:state.requestId,fingerprint:state.fingerprint,operationKey:randomUUID(),reason:"Acuse previo a revocación"} as const;
    await actOnAgeExceptionForActor(actors.secretary,reg.registrationId,command);
    try {
      await db.$transaction(async tx => { await lockAuthorization(tx, "exclusive"); await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Revocación sintética P104',true)`; await tx.role_permissions.delete({ where }); });
      await assert.rejects(actOnAgeExceptionForActor(actors.secretary,reg.registrationId,command),e=>e instanceof AuthorizationError);
      await assert.rejects(recoverAgeExceptionForActor(actors.secretary,reg.registrationId,command.operationKey),e=>e instanceof AuthorizationError);
    } finally {
      await db.$transaction(async tx => { await lockAuthorization(tx, "exclusive"); await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Restauración del fixture P104',true)`; await tx.role_permissions.upsert({where,update:{context_only:grant.context_only},create:{ role_id: grant.role_id, permission_id: grant.permission_id, context_only: grant.context_only }}); });
    }
  });
  await t.test("PDGLD-104: SQL no escribe una autorización sin acuse de decisión", async () => {
    const { reg } = await ready();
    await assert.rejects(db.player_registrations.update({ where: { id: reg.registrationId }, data: { authorized_by: actors.secretary, age_exception_reason: "Sin acuse" } }),
      error => String(error).includes("PLAYER_AGE_EXCEPTION_RECEIPT_REQUIRED") || JSON.stringify(error).includes("PLAYER_AGE_EXCEPTION_RECEIPT_REQUIRED"));
    assert.equal((await readAgeExceptionForActor(actors.secretary, reg.registrationId)).status, "PENDING");
  });
  await t.test("PDGLD-104: no combina SUPERADMIN global con Secretaría de otra liga", async () => {
    const { reg } = await ready();
    const state = await readAgeExceptionForActor(actors.secretary, reg.registrationId);
    const assignment = await db.$transaction(async tx => {
      await lockAuthorization(tx, "exclusive");
      await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Designación sintética en otra liga P104',true)`;
      const club = await tx.clubs.findUniqueOrThrow({where:{id:origin.clubId}});
      const otherLeague = await tx.leagues.findFirstOrThrow({where:{id:{not:club.league_id}}});
      const role = await tx.roles.findUniqueOrThrow({where:{code:"SECRETARY"}});
      return tx.user_roles.create({data:{user_id:actors.admin,role_id:role.id,league_id:otherLeague.id,starts_at:new Date(Date.now()-1000)}});
    });
    try {
      await assert.rejects(actOnAgeExceptionForActor(actors.admin,reg.registrationId,{action:"DECIDE",decision:"APPROVE",requestId:state.requestId,
        fingerprint:state.fingerprint,operationKey:randomUUID(),reason:"No combina asignaciones"}),e=>e instanceof AuthorizationError);
    } finally {
      await db.$transaction(async tx => {
        await lockAuthorization(tx,"exclusive");
        await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Cese de designación sintética P104',true)`;
        await tx.$executeRaw`UPDATE sports_management.user_roles SET ends_at=clock_timestamp() WHERE id=${assignment.id}::uuid`;
      });
    }
  });
  await t.test("Compatibilidad PDGLD-117/104: corregir identidad invalida excepción aprobada sin borrar su acuse",async()=>{
    const reg=await registerPlayerForActor(actors.delegate,payload("2013-11-11"));
    await attach(reg.registrationId);
    let state=await readAgeExceptionForActor(actors.delegate,reg.registrationId);
    await actOnAgeExceptionForActor(actors.delegate,reg.registrationId,{action:"REQUEST",operationKey:randomUUID(),fingerprint:state.fingerprint,documentId:state.documentId,reason:"Solicitud sintética para compatibilidad"});
    state=await readAgeExceptionForActor(actors.secretary,reg.registrationId);
    await actOnAgeExceptionForActor(actors.secretary,reg.registrationId,{action:"DECIDE",decision:"APPROVE",requestId:state.requestId,fingerprint:state.fingerprint,operationKey:randomUUID(),reason:"Carta aprobada antes de rectificación sintética"});
    const before=await db.$transaction(tx=>readAgeExceptionRecord(tx,reg.registrationId,fixture.categoryId));
    assert.equal(before.validApproval,true);
    const row=await db.player_registrations.findUniqueOrThrow({where:{id:reg.registrationId},include:{people:true}});
    const person=row.people;
    const correction=await requestIdentityCorrectionForActor(actors.delegate,reg.registrationId,{
      operationKey:randomUUID(),expectedIdentityVersion:person.identity_version,
      identity:{curp:person.curp,firstName:"Caso Rectificado",paternalSurname:person.paternal_surname,maternalSurname:person.maternal_surname,birthDate:person.birth_date!.toISOString().slice(0,10)},
      reason:"Rectificación sintética de la misma persona",identityDoubt:false,
    },[{kind:"CIVIL_RECORD",mimeType:file.mimeType,bytes:file.bytes}]);
    await decideIdentityCorrectionForActor(actors.admin,reg.registrationId,correction.id,{operationKey:randomUUID(),decision:"APPLY",observations:"Evidencia sintética de nombre comprobada",evidenceChecked:true,samePersonChecked:true,curpDiscrepancy:false});
    const after=await db.$transaction(tx=>readAgeExceptionRecord(tx,reg.registrationId,fixture.categoryId));
    assert.equal(after.validApproval,false);
    assert.notEqual(after.binding,before.binding);
    assert.equal(after.registration.authorized_by,before.registration.authorized_by);
    assert.equal(after.registration.age_exception_file_id,before.registration.age_exception_file_id);
    assert.equal(await db.audit_logs.count({where:{entity_id:reg.registrationId,action:"PLAYER_AGE_EXCEPTION_DECIDED"}}),1);
    const workspace=await readPlayerParticipationWorkspaceForActor(actors.admin,reg.registrationId);
    assert.ok(workspace.source.assessment);
    assert.ok(workspace.source.assessment.blockers.some(b=>b.code==="AGE_REQUIRES_REVIEW"));
    assert.equal(workspace.source.status,"INELIGIBLE");
  });
}
