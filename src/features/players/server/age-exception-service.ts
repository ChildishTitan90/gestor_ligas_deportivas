import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { AuthorizationError, getPermissionGrants, type PermissionGrant } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { readPlayerPolicy } from "@/features/competitions/server/player-policy";
import { CompetitionError } from "@/features/competitions/server/configuration";
import { ageExceptionCommandSchema, type AgeExceptionState } from "../age-exception";
import { assertPlayerRegistrationRead, lockPlayerTeamContext, PlayerRegistrationError } from "./access";
import { readAgeExceptionRecord, ageExceptionDigest, ageExceptionEventId } from "./age-exception-record";
import { playerClubScope } from "./player-scope";
import { readRegistrationLabels } from "./registration-labels";

export async function requireAgeExceptionRole(tx: Prisma.TransactionClient, grants: PermissionGrant[], roleCode: "SECRETARY" | "CLUB_DELEGATE") {
  const role = await tx.roles.findUnique({ where: { code: roleCode }, select: { id: true } });
  if (!role || !grants.some(g => g.roleId === role.id)) throw new AuthorizationError();
}
async function contextFor(tx: Prisma.TransactionClient, actorId: string, id: string, write = false) {
  if (!z.uuid().safeParse(id).success) throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
  const reg = await tx.player_registrations.findUnique({ where: { id }, select: { season_team_id: true } });
  if (!reg) throw new AuthorizationError();
  const context = await assertPlayerRegistrationRead(tx, actorId, id, reg.season_team_id);
  if (write) {
    await tx.$queryRaw`SELECT pr.id FROM sports_management.player_registrations pr JOIN sports_management.people p ON p.id=pr.person_id WHERE pr.id=${id}::uuid FOR UPDATE OF pr,p`;
    if (context.seasonStatus === "CLOSED" || context.teamStatus === "WITHDRAWN" || context.affiliationStatus !== "APPROVED" || !context.categoryAuthorized || !context.operational)
      throw new PlayerRegistrationError("CONTEXT_NOT_AVAILABLE");
    try { await readPlayerPolicy(tx, context.seasonId, context.seasonCategoryId); }
    catch (error) { if (!(error instanceof CompetitionError)) throw error; throw new PlayerRegistrationError("PLAYER_POLICY_PENDING"); }
  }
  return context;
}
async function permitted(tx: Prisma.TransactionClient, actorId: string, teamId: string, role: "SECRETARY" | "CLUB_DELEGATE") {
  const action = role === "SECRETARY" ? "APPROVE" : "UPDATE";
  const { grants } = await lockPlayerTeamContext(tx, actorId, teamId, action);
  await requireAgeExceptionRole(tx, grants, role);
}
export async function readAgeExceptionForActor(actorId: string, registrationId: string): Promise<AgeExceptionState> {
  return getPrisma().$transaction(async tx => {
    const context = await contextFor(tx, actorId, registrationId);
    const state = await readAgeExceptionRecord(tx, registrationId, context.seasonCategoryId);
    let request = false, review = false;
    for (const role of ["CLUB_DELEGATE", "SECRETARY"] as const) {
      try { await permitted(tx, actorId, context.seasonTeamId, role); if (role === "SECRETARY") review = true; else request = true; }
      catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
    }
    const open = state.registration.status === "INELIGIBLE" && !state.registration.withdrawn_at && context.seasonStatus !== "CLOSED" &&
      context.teamStatus !== "WITHDRAWN" && context.affiliationStatus === "APPROVED" && context.categoryAuthorized && context.operational;
    return { registrationId, applicable: state.captured, status: state.status, fingerprint: state.fingerprint,
      requestId: state.request?.id ?? null, documentId: state.document?.id ?? null,
      requestReason: state.request?.reason ?? null, decisionReason: state.decision?.reason ?? null,
      canRequest: open && request && state.applicable && ["DRAFT", "REJECTED", "STALE"].includes(state.status),
      canReview: open && review && state.status === "PENDING" && state.request?.user_id !== actorId, rule: state.rule };
  }, { isolationLevel: "RepeatableRead" });
}
export async function readAgeException(registrationId: string) {
  return readAgeExceptionForActor((await requireOperationalUser()).id, registrationId);
}

export async function recoverAgeExceptionForActor(actorId: string, id: string, operationKey: string) {
  if (!z.uuid().safeParse(operationKey).success) throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
  return getPrisma().$transaction(async tx => {
    const context = await contextFor(tx, actorId, id);
    const operationId = ageExceptionEventId("age-exception-operation:v1", actorId, operationKey);
    const event = await tx.audit_logs.findUnique({ where: { id: operationId }, select: { id: true, entity_id: true, user_id: true, action: true, new_data: true } });
    if (!event || event.entity_id !== id || event.user_id !== actorId) return { confirmed: false as const, registrationId: id, operationKey };
    if (!["PLAYER_AGE_EXCEPTION_REQUESTED", "PLAYER_AGE_EXCEPTION_DECIDED"].includes(event.action)) throw new AuthorizationError();
    const action = event.action === "PLAYER_AGE_EXCEPTION_REQUESTED" ? "REQUEST" as const : "DECIDE" as const;
    await permitted(tx, actorId, context.seasonTeamId, action === "REQUEST" ? "CLUB_DELEGATE" : "SECRETARY");
    return { confirmed: true as const, registrationId: id, operationKey, action,
      requestId: action === "REQUEST" ? event.id : (event.new_data as { requestId: string }).requestId, replayed: true };
  });
}

export async function actOnAgeExceptionForActor(actorId: string, id: string, input: unknown) {
  const parsed = ageExceptionCommandSchema.safeParse(input);
  if (!parsed.success) throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
  const body = parsed.data;
  const operationId = ageExceptionEventId("age-exception-operation:v1", actorId, body.operationKey);
  const requestHash = ageExceptionDigest([id, body]);
  return getPrisma().$transaction(async tx => {
    // La autoridad se revalida también al recuperar una respuesta anterior.
    const context = await contextFor(tx, actorId, id);
    await permitted(tx, actorId, context.seasonTeamId, body.action === "REQUEST" ? "CLUB_DELEGATE" : "SECRETARY");
    await tx.$queryRaw`SELECT id FROM sports_management.player_registrations WHERE id=${id}::uuid FOR UPDATE`;
    const prior = await tx.audit_logs.findUnique({ where: { id: operationId }, select: { id: true, entity_id: true, user_id: true, action: true, new_data: true } });
    const eventAction = body.action === "REQUEST" ? "PLAYER_AGE_EXCEPTION_REQUESTED" : "PLAYER_AGE_EXCEPTION_DECIDED";
    if (prior) {
      const receipt = prior.new_data as { requestHash?: string; requestId?: string };
      if (prior.entity_id !== id || prior.user_id !== actorId || prior.action !== eventAction || receipt.requestHash !== requestHash)
        throw new PlayerRegistrationError("AGE_EXCEPTION_CONFLICT");
      return { confirmed: true as const, registrationId: id, operationKey: body.operationKey,
        requestId: body.action === "REQUEST" ? operationId : body.requestId, action: body.action, replayed: true };
    }
    await contextFor(tx, actorId, id, true);
    const state = await readAgeExceptionRecord(tx, id, context.seasonCategoryId);
    if (!state.applicable || state.registration.status !== "INELIGIBLE" || state.registration.withdrawn_at)
      throw new PlayerRegistrationError("AGE_EXCEPTION_NOT_APPLICABLE");
    if (body.fingerprint !== state.fingerprint) throw new PlayerRegistrationError("AGE_EXCEPTION_STALE");
    if (!state.document) throw new PlayerRegistrationError("AGE_EXCEPTION_DOCUMENT_REQUIRED");
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${body.reason},true)`;
    if (body.action === "REQUEST") {
      if (!["DRAFT", "REJECTED", "STALE"].includes(state.status)) throw new PlayerRegistrationError("AGE_EXCEPTION_CONFLICT");
      if (body.documentId !== state.document.id) throw new PlayerRegistrationError("AGE_EXCEPTION_DOCUMENT_REQUIRED");
      await tx.audit_logs.create({ data: { id: operationId, user_id: actorId, action: eventAction,
        table_name: "player_registrations", entity_id: id, reason: body.reason,
        new_data: { version: state.version + 1, binding: state.binding, documentId: state.document.id,
          fileId: state.document.file_id, requestHash } } });
    } else {
      if (!state.request || state.request.id !== body.requestId || state.status !== "PENDING") throw new PlayerRegistrationError("AGE_EXCEPTION_CONFLICT");
      if (state.request.user_id === actorId) throw new AuthorizationError();
      await tx.audit_logs.create({ data: { id: operationId, user_id: actorId, action: eventAction,
        table_name: "player_registrations", entity_id: id, reason: body.reason,
        new_data: { requestId: body.requestId, binding: state.binding, documentId: state.document.id,
          fileId: state.document.file_id, requestHash, decision: body.decision } } });
      const approved = body.decision === "APPROVE";
      await tx.player_documents.update({ where: { id: state.document.id }, data: { status: approved ? "VALIDATED" : "REJECTED", reviewed_by: actorId } });
      await tx.$queryRaw`SELECT set_config('app.age_exception_event_id',${operationId},true)`;
      await tx.player_registrations.update({ where: { id }, data: {
        authorized_by: approved ? actorId : null, age_exception_reason: approved ? body.reason : null,
        age_exception_file_id: approved ? state.document.file_id : null,
      } });
    }
    return { confirmed: true as const, registrationId: id, operationKey: body.operationKey,
      requestId: body.action === "REQUEST" ? operationId : body.requestId, action: body.action, replayed: false };
  }, { timeout: 20000 });
}
export async function getAgeExceptionQueueForActor(actorId: string) {
  const candidates = await getPrisma().$transaction(async tx => {
    const role = await tx.roles.findUnique({where:{code:"SECRETARY"},select:{id:true}});
    const approve=(await getPermissionGrants(tx,actorId,"players","APPROVE")).filter(g=>g.roleId===role?.id);
    const read=await getPermissionGrants(tx,actorId,"players","READ");
    if(!approve.length || !read.length)return [];
    return tx.player_registrations.findMany({where:{status:"INELIGIBLE",withdrawn_at:null,
      season_teams:{teams:{clubs:{AND:[playerClubScope(approve),playerClubScope(read)]}}}},select:{id:true},orderBy:{id:"asc"}});
  });
  const result = [];
  for (const row of candidates) {
    try {
      const state = await readAgeExceptionForActor(actorId, row.id);
      if (state.canReview) {
        const labels = await getPrisma().$transaction(async tx => {
          await contextFor(tx, actorId, row.id);
          return readRegistrationLabels(tx, row.id);
        });
        result.push(labels);
      }
    } catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
  }
  return result;
}
