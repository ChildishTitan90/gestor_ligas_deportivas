import { effectiveCaptain } from "../captaincy";
import "server-only";
import { matchClockSchema } from "../match-clock";
import { evaluateAuthorizedMatchInTransaction } from "@/features/matches/server/eligibility";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { createSupabasePrivateDocumentStorage, PrivateDocumentStorageError, type PrivateDocumentTransport } from "@/server/files/private-document-storage";
import { resolve, relative, isAbsolute } from "node:path";
import { validatePrivateFileContent } from "@/server/files/private-file-validation";
import { AuthorizationError } from "@/server/auth/authorization";
import { assertCaptureState, reportAccess, reportReadAccess } from "./access";
import { draftSchema, ReportError, unsignedDraft, type ReportDraft } from "../contract";
import { localSignatureStorage } from "./local-signature-storage";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const bytesHash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const signatureSchema = z.strictObject({ operationId: z.uuid(), matchId: z.uuid(), teamId: z.uuid(), captainId: z.uuid(), expectedMatchVersion: z.number().int().positive(), expectedReportVersion: z.number().int().nonnegative(), draft: draftSchema, image: z.string().max(1500000).startsWith("data:image/png;base64,") });
type SignatureIntent = { matchId: string; teamId: string; captainId: string; binding: string; objectKey: string; sha256: string; sizeBytes: number };
async function bindingFor(tx: Prisma.TransactionClient, draft: ReportDraft) {
  const identities = await tx.player_registrations.findMany({ where: { id: { in: draft.lineups.filter(row => row.selected).map(row => row.playerId) } }, orderBy: { id: "asc" }, select: { id: true, people: { select: { identity_version: true } } } });
  return hash([unsignedDraft(draftSchema.parse(draft)), identities]);
}
export function createReportSignatureStorage(environment: Record<string, string | undefined> = process.env) {
  if ((environment.NODE_ENV === "development" || environment.AUTH_TEST_RUN === "1") && environment.REPORT_SIGNATURE_LOCAL_DIRECTORY) {
    let local = environment.AUTH_TEST_RUN === "1";
    try {
      const target = new URL(environment.DATABASE_URL ?? "");
      local ||= ["postgres:", "postgresql:"].includes(target.protocol) && ["127.0.0.1", "localhost"].includes(target.hostname)
        && target.port === "5433" && target.pathname === "/gestor_ligas_dev" && [...target.searchParams.keys()].every(key => key === "schema");
    } catch { /* Sin un destino local comprobado no se activa este perfil. */ }
    const fromPublic = relative(resolve("public"), resolve(environment.REPORT_SIGNATURE_LOCAL_DIRECTORY));
    if (!local || (!fromPublic.startsWith("..") && !isAbsolute(fromPublic))) throw new PrivateDocumentStorageError();
    return localSignatureStorage(environment.REPORT_SIGNATURE_LOCAL_DIRECTORY);
  }
  return createSupabasePrivateDocumentStorage({ bucket: "cedulas-firmas", variable: "SUPABASE_REPORT_SIGNATURES_BUCKET", prefix: "report-signatures", testFlag: "REPORT_SIGNATURE_STORAGE_REAL_TEST" }, environment);
}
export async function validateSignatureReferences(tx: Prisma.TransactionClient, _actor: string, match: Awaited<ReturnType<typeof reportAccess>>, draft: ReportDraft) {
  for (const [teamId, fileId] of Object.entries(draft.signatures)) {
    if (!fileId) continue;
    if (![match.home_team_id, match.away_team_id].includes(teamId)) throw new ReportError("INVALID_SIGNATURE_REFERENCE", 400);
    const intent = await tx.audit_logs.findUnique({ where: { id: fileId }, select: { action: true, new_data: true } });
    const file = await tx.files.findUnique({ where: { id: fileId }, select: { sha256: true, storage_key: true } });
    const meta = intent?.new_data as unknown as SignatureIntent;
    if (!file || intent?.action !== "REPORT_SIGNATURE_PREPARED" || meta.matchId !== match.id || meta.teamId !== teamId || meta.captainId !== effectiveCaptain(draft.captains[teamId], draft.events, teamId) || meta.binding !== await bindingFor(tx, draft) || meta.sha256 !== file.sha256 || meta.objectKey !== file.storage_key) throw new ReportError("INVALID_SIGNATURE_REFERENCE", 400);
  }
}
/** Storage fuera de SQL: intención durable -> PUT inmutable -> verificación -> reautorización y enlace. */
export async function uploadReportSignature(actorId: string, input: unknown, storage: PrivateDocumentTransport) {
  const parsed = signatureSchema.safeParse(input);
  if (!parsed.success) throw new ReportError("INVALID_SIGNATURE", 400);
  const command = parsed.data;
  const bytes = Buffer.from(command.image.slice("data:image/png;base64,".length), "base64");
  const file = await validatePrivateFileContent(bytes, "image/png");
  const raw = hash([actorId, command.operationId]);
  const fileId = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-5${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
  async function authorize(tx: Prisma.TransactionClient) {
    let existing = await tx.match_reports.findUnique({ where: { match_id: command.matchId }, select: { version: true } });
    const match = await reportAccess(tx, actorId, command.matchId, existing ? "UPDATE" : "CREATE");
    const fresh = await tx.match_reports.findUnique({ where: { match_id: command.matchId }, select: { version: true } });
    if (fresh && !existing) await reportAccess(tx, actorId, command.matchId, "UPDATE");
    existing = fresh;
    assertCaptureState(match);
    if (match.version !== command.expectedMatchVersion || (existing?.version ?? 0) !== command.expectedReportVersion) throw new ReportError("STALE_VERSION");
    const selected = command.draft.lineups.find(row => row.playerId === command.captainId && row.teamId === command.teamId && row.selected);
    if (![match.home_team_id, match.away_team_id].includes(command.teamId) || !selected || effectiveCaptain(command.draft.captains[command.teamId],command.draft.events,command.teamId) !== command.captainId) throw new ReportError("INVALID_CAPTAIN", 400);
    const current = await tx.match_reports.findUnique({ where: { match_id: match.id }, select: { draft_data: true } });
    const rawClock = (current?.draft_data as { clock?: unknown } | undefined)?.clock;
    const parsedClock = matchClockSchema.safeParse(rawClock);
    const evaluation = await evaluateAuthorizedMatchInTransaction(tx, match, { draft: command.draft, clock: parsedClock.success ? parsedClock.data : null });
    if (!evaluation.players.some(player => player.registrationId === command.captainId && player.seasonTeamId === command.teamId && player.eligible)) throw new ReportError("PLAYER_NOT_ELIGIBLE");
    return match;
  }
  const meta = await getPrisma().$transaction(async tx => {
    const match = await authorize(tx);
    const binding = await bindingFor(tx, command.draft);
    const objectKey = `report-signatures/v1/${match.season.league_id}/${match.season_id}/${match.id}/${actorId}/${command.operationId}`;
    const value: SignatureIntent = { matchId: match.id, teamId: command.teamId, captainId: command.captainId, binding, objectKey, sha256: file.sha256, sizeBytes: file.sizeBytes };
    const prior = await tx.audit_logs.findUnique({ where: { id: fileId } });
    if (prior && (prior.user_id !== actorId || prior.action !== "REPORT_SIGNATURE_PREPARED" || hash(prior.new_data) !== hash(value))) throw new ReportError("OPERATION_KEY_REUSED");
    if (!prior) await tx.audit_logs.create({ data: { id: fileId, user_id: actorId, action: "REPORT_SIGNATURE_PREPARED", table_name: "match_reports", entity_id: match.id, new_data: value, reason: "Intención de firma privada de capitán" } });
    return value;
  }, { timeout: 30000 });
  await storage.put(meta.objectKey, file);
  const stored = await storage.read(meta.objectKey, file.sizeBytes, "image/png");
  if (stored.byteLength !== file.sizeBytes || bytesHash(stored) !== file.sha256) throw new ReportError("SIGNATURE_STORAGE_MISMATCH");
  await getPrisma().$transaction(async tx => {
    await authorize(tx);
    if (await bindingFor(tx, command.draft) !== meta.binding) throw new ReportError("SIGNATURE_IDENTITY_CHANGED");
    const prior = await tx.files.findUnique({ where: { id: fileId } });
    if (prior && (prior.storage_key !== meta.objectKey || prior.sha256 !== file.sha256 || prior.uploaded_by !== actorId)) throw new ReportError("OPERATION_KEY_REUSED");
    if (!prior) await tx.files.create({ data: { id: fileId, storage_key: meta.objectKey, original_name: "firma-capitan.png", mime_type: "image/png", size_bytes: file.sizeBytes, sha256: file.sha256, uploaded_by: actorId } });
  }, { timeout: 30000 });
  return { fileId, captainId: command.captainId, teamId: command.teamId, binding: meta.binding };
}
export async function readReportSignature(actorId: string, matchId: string, fileId: string, storage: PrivateDocumentTransport) {
  async function authorize() {
    return getPrisma().$transaction(async tx => {
      await reportReadAccess(tx, actorId, matchId);
      const report = await tx.match_reports.findUnique({ where: { match_id: matchId }, select: { home_captain_signature_file_id: true, away_captain_signature_file_id: true } });
      if (!report || ![report.home_captain_signature_file_id, report.away_captain_signature_file_id].includes(fileId)) throw new AuthorizationError();
      const file = await tx.files.findUniqueOrThrow({ where: { id: fileId }, select: { storage_key: true, sha256: true, mime_type: true } });
      if (!file.storage_key.startsWith("report-signatures/v1/")) throw new AuthorizationError();
      return file;
    });
  }
  const file = await authorize();
  const bytes = await storage.read(file.storage_key, 1048576, "image/png");
  if (bytesHash(bytes) !== file.sha256) throw new ReportError("SIGNATURE_STORAGE_MISMATCH");
  const current = await authorize();
  if (current.sha256 !== file.sha256 || current.storage_key !== file.storage_key) throw new AuthorizationError();
  return bytes;
}
