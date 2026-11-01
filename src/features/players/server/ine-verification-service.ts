import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { AuthorizationError, getPermissionGrants } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { validatePrivateFileContent, type ValidatedBinaryFile } from "@/server/files/private-file-validation";
import { assertPlayerRegistrationRead, lockPlayerTeamContext } from "./access";
import { ineIntentSchema, ineOutcomes, ineParts, type IneOutcome, type IneStatus } from "../ine-verification";
import { getVerificamexIneProvider, ineProviderResultSchema, type IneImages, type IneProvider } from "./verificamex-ine";
import {matchIneIdentity,type IneMatch} from "../ine-identity-match";
import type {PlayerIdentityInput} from "../schemas";
import type { PlayerDocumentTransport } from "./document-storage";

export class IneVerificationError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
const preparedAction = "PLAYER_INE_PREPARED", resultAction = "PLAYER_INE_RESULT";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function operationId(actorId: string, key: string) {
  const h = hash(["player-ine:v1", actorId, key]);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
type Evidence = { sha256: string; sizeBytes: number; mimeType: string };
type Intent = { version: number; fingerprint: string; snapshotHash: string; evidence: Record<typeof ineParts[number], Evidence>; context: { leagueId: string; seasonId: string }; };
const purposeIds = { front: "17e075ad-e03c-4e19-b922-8b1180239cfa", back: "455e27b9-521c-4e0a-869d-048869c4fb45", selfie: "a121722e-bd01-4a0f-bd10-c2c26dfd3905" };
function evidenceKey(registrationId: string, attemptId: string, intent: Intent, part: typeof ineParts[number]) {
  return `player-documents/v1/${intent.context.leagueId}/${intent.context.seasonId}/${registrationId}/${purposeIds[part]}/${attemptId}`;
}
async function snapshot(tx: Prisma.TransactionClient, actorId: string, id: string, write = false) {
  if (!z.uuid().safeParse(id).success) throw new AuthorizationError();
  const reg = await tx.player_registrations.findUnique({ where: { id }, select: { season_team_id: true } });
  if (!reg) throw new AuthorizationError();
  const context = await assertPlayerRegistrationRead(tx, actorId, id, reg.season_team_id);
  if (write) await lockPlayerTeamContext(tx, actorId, reg.season_team_id, "UPDATE");
  await tx.$queryRaw`SELECT pr.id FROM sports_management.player_registrations pr JOIN sports_management.people p ON p.id=pr.person_id WHERE pr.id=${id}::uuid FOR SHARE OF pr,p`;
  const locked = await tx.player_registrations.findUniqueOrThrow({ where: { id }, select: {
    season_team_id: true, status: true, withdrawn_at: true, people: { select: { identity_version: true,curp:true,first_name:true,paternal_surname:true,maternal_surname:true,birth_date:true } },
  } });
  if (locked.season_team_id !== reg.season_team_id) throw new IneVerificationError("CONTEXT_UNAVAILABLE");
  const category = await tx.season_categories.findUniqueOrThrow({ where: { id: context.seasonCategoryId }, select: { type: true } });
  const applicable = category.type === "VETERANS";
  const available = applicable && locked.status === "INELIGIBLE" && !locked.withdrawn_at && context.seasonStatus !== "CLOSED" && context.teamStatus !== "WITHDRAWN" && context.affiliationStatus === "APPROVED" && context.categoryAuthorized;
  if (write && !available) throw new IneVerificationError("CONTEXT_UNAVAILABLE");
  const identity:PlayerIdentityInput={curp:locked.people.curp ?? "",firstName:locked.people.first_name,paternalSurname:locked.people.paternal_surname,maternalSurname:locked.people.maternal_surname,birthDate:locked.people.birth_date?.toISOString().slice(0,10) ?? ""};
  return { applicable, available, version: locked.people.identity_version, context,identity,
    snapshotHash: hash([context, locked.people.identity_version, locked.status, locked.withdrawn_at, category.type]) };
}
async function dto(tx: Prisma.TransactionClient, actorId: string, id: string, attemptId?: string): Promise<IneStatus> {
  const current = await snapshot(tx, actorId, id);
  let canSubmit = false;
  try { await lockPlayerTeamContext(tx, actorId, current.context.seasonTeamId, "UPDATE"); canSubmit = current.available; }
  catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
  const attempt = await tx.audit_logs.findFirst({ where: { entity_id: id, action: preparedAction, ...(attemptId ? { id: attemptId } : {}) }, orderBy: [{ occurred_at: "desc" }, { id: "desc" }], select: { id: true, new_data: true, occurred_at: true } });
  if (attemptId && !attempt) throw new AuthorizationError();
  let status: IneStatus["status"] = "NOT_STARTED";
  if (attempt) {
    const intent = attempt.new_data as unknown as Intent;
    const result = await tx.audit_logs.findFirst({ where: { entity_id: id, action: resultAction, new_data: { path: ["attemptId"], equals: attempt.id } }, select: { new_data: true } });
    const outcome = z.enum(ineOutcomes).safeParse((result?.new_data as { outcome?: string } | undefined)?.outcome);
    status = intent.snapshotHash !== current.snapshotHash ? "STALE" : outcome.success ? outcome.data : Date.now() - attempt.occurred_at.getTime() > 120000 ? "UNCERTAIN" : "PENDING";
    // Acuses anteriores sin cotejo no se convierten en identidad verificada.
    if(status==="PROVIDER_PASSED" || (status==="IDENTITY_VERIFIED" && (result?.new_data as {matchingVersion?:number})?.matchingVersion!==1))status="ADMIN_REVIEW_REQUIRED";
  }
  return { registrationId: id, applicable: current.applicable, canSubmit, identityVersion: current.version, attemptId: attempt?.id ?? null, status, approvalAllowed: false };
}
export async function readPlayerIneStatusForActor(actorId: string, id: string, attemptId?: string) {
  if (attemptId && !z.uuid().safeParse(attemptId).success) throw new AuthorizationError();
  return getPrisma().$transaction(tx => dto(tx, actorId, id, attemptId), { timeout: 15000 });
}
export async function authorizePlayerIneUploadForActor(actorId: string, id: string) {
  await getPrisma().$transaction(tx => snapshot(tx, actorId, id, true));
}

export async function getIneReviewQueue() {
  const actor = await requireOperationalUser();
  return readIneReviewQueueForActor(actor.id);
}
export async function readIneReviewQueueForActor(actorId: string) {
  return getPrisma().$transaction(async tx => {
    const grants = await getPermissionGrants(tx, actorId, "players", "APPROVE");
    if (!grants.length) throw new AuthorizationError();
    const scope: Prisma.clubsWhereInput = grants.some(g => !g.contextOnly && !g.clubId && !g.leagueId) ? {} : {
      OR: grants.flatMap((g): Prisma.clubsWhereInput[] => g.clubId ? [{ id: g.clubId, ...(g.leagueId ? { league_id: g.leagueId } : {}) }] : g.leagueId ? [{ league_id: g.leagueId }] : []),
    };
    const rows = await tx.player_registrations.findMany({ where: { status: "INELIGIBLE", withdrawn_at: null, season_teams: { teams: { clubs: scope } } }, select: { id: true, season_team_id: true, season_teams: { select: { teams: { select: { name: true } } } } }, orderBy: { id: "asc" } });
    const result = [];
    for (const row of rows) {
      try {
        await lockPlayerTeamContext(tx, actorId, row.season_team_id, "APPROVE");
        const state = await dto(tx, actorId, row.id);
        if (state.applicable && state.attemptId && state.status !== "PENDING" && state.status!=="IDENTITY_VERIFIED") result.push({ id: row.id, team: row.season_teams.teams.name, status: state.status });
      } catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
    }
    return result;
  }, { timeout: 15000 });
}

/** Una intención consume a lo sumo una llamada. Una pérdida de respuesta nunca se reenvía automáticamente. */
export async function verifyPlayerIneForActor(actorId: string, id: string, input: unknown,
  raw: Record<typeof ineParts[number], { bytes: Uint8Array; mimeType: string }>,
  dependencies: { storage: PlayerDocumentTransport; provider?: IneProvider; limits?: { daily: number; actorDaily: number } }) {
  const parsed = ineIntentSchema.safeParse(input);
  if (!parsed.success) throw new IneVerificationError("INVALID_PAYLOAD", 400);
  await authorizePlayerIneUploadForActor(actorId, id);
  const images = {} as IneImages;
  for (const part of ineParts) {
    if (!["image/png", "image/jpeg"].includes(raw[part].mimeType)) throw new IneVerificationError("IMAGES_REQUIRED", 400);
    images[part] = await validatePrivateFileContent(raw[part].bytes, raw[part].mimeType);
  }
  const evidence = Object.fromEntries(ineParts.map(p => [p, { sha256: images[p].sha256, sizeBytes: images[p].sizeBytes, mimeType: images[p].mimeType }])) as Intent["evidence"];
  const body = parsed.data, db = getPrisma();
  const prepared = await db.$transaction(async tx => {
    const current = await snapshot(tx, actorId, id, true);
    if (body.identityVersion !== current.version) throw new IneVerificationError("IDENTITY_CHANGED");
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(98,2026)::text`;
    const attemptId = operationId(actorId, body.operationKey);
    const fingerprint = hash([id, current.snapshotHash, evidence]);
    const prior = await tx.audit_logs.findUnique({ where: { id: attemptId }, select: { entity_id: true, action: true, new_data: true } });
    if (prior) {
      if (prior.entity_id !== id || prior.action !== preparedAction || (prior.new_data as unknown as Intent).fingerprint !== fingerprint) throw new IneVerificationError("OPERATION_CONFLICT");
      return { done: await dto(tx, actorId, id, attemptId) };
    }
    const latest = await dto(tx, actorId, id);
    if (latest.attemptId) {
      if (latest.status === "PENDING" || latest.status === "IDENTITY_VERIFIED") return { done: latest };
      if (body.retryOf !== latest.attemptId || !body.acknowledgePossiblePreviousCharge) throw new IneVerificationError("RETRY_CONFIRMATION_REQUIRED");
    } else if (body.retryOf) throw new IneVerificationError("OPERATION_CONFLICT");
    const provider = dependencies.provider ?? getVerificamexIneProvider();
    if (!provider.configured) throw new IneVerificationError("NOT_CONFIGURED", 503);
    const [clock] = await tx.$queryRaw<{ day: Date }[]>`SELECT date_trunc('day',clock_timestamp() AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'America/Mexico_City' AS day`;
    const limits = dependencies.limits ?? { daily: 2, actorDaily: 1 };
    const where = { action: preparedAction, occurred_at: { gte: clock.day } };
    if (await tx.audit_logs.count({ where }) >= limits.daily || await tx.audit_logs.count({ where: { ...where, user_id: actorId } }) >= limits.actorDaily) throw new IneVerificationError("USAGE_LIMIT_REACHED", 429);
    const intent: Intent = { version: current.version, snapshotHash: current.snapshotHash, fingerprint, evidence, context: { leagueId: current.context.leagueId, seasonId: current.context.seasonId } };
    await tx.audit_logs.create({ data: { id: attemptId, user_id: actorId, entity_id: id, table_name: "player_registrations", action: preparedAction,
      reason: "INE y selfie: intención humana explícita; sin aprobación deportiva", new_data: JSON.parse(JSON.stringify(intent)) } });
    return { attemptId, intent, provider,identity:current.identity };
  }, { timeout: 15000 });
  if (prepared.done) return prepared.done;
  const { attemptId, intent, provider,identity } = prepared;
  let outcome: IneOutcome = "STORAGE_FAILED";
  let matching: IneMatch|undefined;
  try {
    for (const part of ineParts) await dependencies.storage.put(evidenceKey(id, attemptId, intent, part), images[part]);
    // Reautorizar tras Storage y justo antes de emitir la consulta que puede generar un cobro.
    await db.$transaction(async tx => {
      const current = await snapshot(tx, actorId, id, true);
      if (current.snapshotHash !== intent.snapshotHash) throw new IneVerificationError("IDENTITY_CHANGED");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(98,2026)::text`;
      const latest = await tx.audit_logs.findFirst({ where: { entity_id: id, action: preparedAction }, orderBy: [{ occurred_at: "desc" }, { id: "desc" }], select: { id: true } });
      if (latest?.id !== attemptId) throw new IneVerificationError("OPERATION_CONFLICT");
    });
    outcome = "UNCERTAIN";
    const result = ineProviderResultSchema.safeParse(await provider.verify(images));
    if(result.success && result.data.status==="PROVIDER_PASSED"){
      matching=matchIneIdentity(identity,result.data.readings);outcome=matching.status;
    }else outcome = result.success ? result.data.status : "ADMIN_REVIEW_REQUIRED";
  } catch { /* Sin reintento de red: conservar incertidumbre o fallo previo al proveedor. */ }
  await db.$transaction(async tx => {
    await tx.audit_logs.create({ data: { id: operationId(actorId, `${body.operationKey}:result`), user_id: actorId,
      entity_id: id, table_name: "player_registrations", action: resultAction,
      reason: "Resultado de INE y cotejo de identidad, sin activar ni rechazar inscripción", new_data: { attemptId, outcome,matchingVersion:1,missingFields:matching?.missingFields ?? [],mismatchedFields:matching?.mismatchedFields ?? [] } } });
  });
  return readPlayerIneStatusForActor(actorId, id, attemptId);
}

/** Evidencia privada de verificación, separada de los requisitos documentales y sus aprobaciones. */
export async function downloadPlayerIneEvidenceForActor(actorId: string, id: string, attemptId: string, part: string, storage: PlayerDocumentTransport) {
  if (!z.uuid().safeParse(attemptId).success || !ineParts.includes(part as typeof ineParts[number])) throw new AuthorizationError();
  const allowedPart = part as typeof ineParts[number];
  const authorize = () => getPrisma().$transaction(async tx => {
    await snapshot(tx, actorId, id);
    const row = await tx.audit_logs.findFirst({ where: { id: attemptId, entity_id: id, action: preparedAction }, select: { new_data: true } });
    if (!row) throw new AuthorizationError();
    return row.new_data as unknown as Intent;
  });
  const intent = await authorize(), key = evidenceKey(id, attemptId, intent, allowedPart);
  const expected = intent.evidence[allowedPart];
  const bytes = await storage.read(key, expected.sizeBytes, expected.mimeType);
  const checked: ValidatedBinaryFile = await validatePrivateFileContent(bytes, expected.mimeType);
  if (checked.sha256 !== expected.sha256 || checked.sizeBytes !== expected.sizeBytes) throw new IneVerificationError("EVIDENCE_CONFLICT");
  const url = await storage.createDownloadUrl(key);
  await authorize();
  return url;
}
