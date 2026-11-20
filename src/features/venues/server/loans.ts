import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { PRIVATE_FILE_MAX_BYTES, validatePrivateFileContent } from "@/server/files/private-file-validation";
import { attachDelegateSignature } from "../signed-letter.client";
import { venueLocalTime } from "../time";
import { createVenueLoanLetterStorage, VENUE_LOAN_LETTER_PREFIX } from "./loan-storage";
import type { PrivateDocumentTransport } from "@/server/files/private-document-storage";

type Tx = Prisma.TransactionClient;
export const windowSchema = z.object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }).strict();
const requestSchema = z.object({
  requestId: z.uuid(), seasonId: z.uuid(), clubId: z.uuid(), venueId: z.uuid(),
  windows: z.array(windowSchema).min(1).max(50),
}).strict();
const decisionSchema = z.object({
  requestId: z.uuid(), status: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().min(8).max(500),
}).strict();
const receipt = { id: true, status: true } as const;
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export class LoanError extends Error {}

async function authorize(tx: Tx, actor: string, action: "CREATE" | "APPROVE", context: {
  clubId: string; seasonId: string;
}) {
  const grants = await assertPermission(tx, actor, { module: "venues", action, context });
  const roles = await tx.roles.findMany({
    where: { id: { in: grants.map(grant => grant.roleId) }, code: action === "CREATE" ? "CLUB_DELEGATE" : "EXECUTIVE_PRESIDENT" },
    select: { id: true },
  });
  if (!roles.length) throw new AuthorizationError();
}

async function requestContext(tx: Tx, actor: string, data: z.infer<typeof requestSchema>) {
  await authorize(tx, actor, "CREATE", { clubId: data.clubId, seasonId: data.seasonId });
  const season = await tx.seasons.findUniqueOrThrow({
    where: { id: data.seasonId },
    select: { league_id: true, status: true, start_date: true, end_date: true, leagues: { select: { timezone: true } } },
  });
  const venue = await tx.venues.findFirst({
    where: { id: data.venueId, league_id: season.league_id, is_active: true, is_league_sports_complex: false,
      owner_club_id: { not: null, notIn: [data.clubId] } }, select: { id: true },
  });
  if (!venue) throw new AuthorizationError();
  return season;
}

async function auditContext(tx: Tx, actor: string, reason: string) {
  await tx.$queryRaw`SELECT set_config('app.user_id', ${actor}, true), set_config('app.reason', ${reason}, true)`;
}

export async function submitVenueLoan(input: unknown, attachment: { bytes: Uint8Array; mimeType: string; signature?: Uint8Array }, storage?: PrivateDocumentTransport) {
  const { id: actor } = await requireOperationalUser();
  return submitVenueLoanForActor(actor, input, attachment, storage);
}

export async function submitVenueLoanForActor(actor: string, input: unknown, attachment: { bytes: Uint8Array; mimeType: string; signature?: Uint8Array }, storage?: PrivateDocumentTransport) {
  const data = requestSchema.parse(input);
  const windows = data.windows.map(w => ({
    startsAt: new Date(w.startsAt).toISOString(), endsAt: new Date(w.endsAt).toISOString(),
  })).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (windows.some((w, i) => w.startsAt >= w.endsAt || (i > 0 && windows[i - 1].endsAt > w.startsAt))) {
    throw new LoanError("INVALID_WINDOWS");
  }
  const original = await validatePrivateFileContent(attachment.bytes, attachment.mimeType);
  const signature = attachment.signature
    ? await validatePrivateFileContent(attachment.signature, "image/png") : null;
  if (signature && signature.mimeType !== "image/png") throw new LoanError("INVALID_SIGNATURE");
  const hash = sha256(JSON.stringify({ ...data, windows, file: original.sha256,
    ...(signature ? { signature: signature.sha256 } : {}) }));
  let file = original;
  if (signature) {
    try {
      const signed = await attachDelegateSignature(
        new File([new Uint8Array(original.bytes)], "carta", { type: original.mimeType }),
        new File([new Uint8Array(signature.bytes)], "firma.png", { type: "image/png" }),
      );
      file = await validatePrivateFileContent(new Uint8Array(await signed.arrayBuffer()), signed.type);
    } catch {
      throw new LoanError("INVALID_SIGNATURE");
    }
  }
  const db = getPrisma();
  const check = async (tx: Tx) => {
    const season = await requestContext(tx, actor, data);
    const existing = await tx.venue_loans.findUnique({ where: { id: data.requestId },
      select: { ...receipt, requested_by: true, request_hash: true } });
    if (existing) {
      if (existing.requested_by !== actor || existing.request_hash !== hash) throw new LoanError("REQUEST_CONFLICT");
      return { receipt: { id: existing.id, status: existing.status }, objectKey: null };
    }
    const cancelled = await tx.audit_logs.findFirst({ where: {
      action: "VENUE_LOAN_CAPTURE_CANCELLED", table_name: "venue_loans", entity_id: data.requestId,
    }, select: { id: true } });
    if (cancelled) throw new LoanError("REQUEST_CANCELLED");
    if (!signature) throw new LoanError("SIGNATURE_REQUIRED");
    if (season.status === "CLOSED") throw new LoanError("SEASON_CLOSED");
    const localDay = (date: Date) => venueLocalTime(date, season.leagues.timezone).slice(0, 10);
    if (windows.some(w => localDay(new Date(w.startsAt)) < season.start_date.toISOString().slice(0, 10) ||
        localDay(new Date(Date.parse(w.endsAt) - 1)) > season.end_date.toISOString().slice(0, 10))) {
      throw new LoanError("WINDOW_OUTSIDE_SEASON");
    }
    return { receipt: null, objectKey: `${VENUE_LOAN_LETTER_PREFIX}/v1/${season.league_id}/${data.seasonId}/${data.clubId}/${actor}/${data.requestId}` };
  };

  const prepared = await db.$transaction(check);
  if (prepared.receipt) return prepared.receipt;
  const transport = storage ?? createVenueLoanLetterStorage();
  try {
    await transport.put(prepared.objectKey, file);
    const stored = await transport.read(prepared.objectKey, PRIVATE_FILE_MAX_BYTES, file.mimeType);
    if (stored.byteLength !== file.sizeBytes || sha256(stored) !== file.sha256) throw new LoanError("LETTER_MISMATCH");

    return await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.requestId}, 2301))`;
      await tx.$queryRaw`SELECT id FROM sports_management.venues WHERE id = ${data.venueId}::uuid FOR UPDATE`;
      const current = await check(tx);
      if (current.receipt) return current.receipt;
      if (current.objectKey !== prepared.objectKey) throw new AuthorizationError();
      const letter = await tx.files.create({ data: {
        storage_key: prepared.objectKey, original_name: "Carta de préstamo de cancha", mime_type: file.mimeType,
        size_bytes: BigInt(file.sizeBytes), sha256: file.sha256, uploaded_by: actor,
      }, select: { id: true } });
      await auditContext(tx, actor, "Solicitud de préstamo de cancha");
      return tx.venue_loans.create({ data: {
        id: data.requestId, season_id: data.seasonId, club_id: data.clubId, venue_id: data.venueId,
        letter_file_id: letter.id, requested_by: actor, request_hash: hash, requested_windows: windows, owner_decision_required: true,
      }, select: receipt });
    });
  } catch (error) {
    const cancelled = await db.audit_logs.findFirst({ where: {
      action: "VENUE_LOAN_CAPTURE_CANCELLED", table_name: "venue_loans", entity_id: data.requestId,
      user_id: actor,
    }, select: { id: true } });
    if (cancelled) {
      if (!transport.remove) throw new Error("VENUE_LOAN_CLEANUP_UNAVAILABLE");
      await transport.remove(prepared.objectKey);
    }
    throw error;
  }
}


export async function resolveLegacyVenueLoanForActor(actor: string, input: { requestId: string; clubId: string; seasonId: string }, storage?: PrivateDocumentTransport) {
  const data = z.object({ requestId: z.uuid(), clubId: z.uuid(), seasonId: z.uuid() }).strict().parse(input);
  const result = await getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.requestId}, 2301))`;
    await authorize(tx, actor, "CREATE", { clubId: data.clubId, seasonId: data.seasonId });
    const existing = await tx.venue_loans.findUnique({ where: { id: data.requestId },
      select: { ...receipt, requested_by: true, club_id: true, season_id: true } });
    if (existing) {
      if (existing.requested_by !== actor || existing.club_id !== data.clubId || existing.season_id !== data.seasonId)
        throw new AuthorizationError();
      return { outcome: "registered" as const, id: existing.id, status: existing.status };
    }
    const prior = await tx.audit_logs.findFirst({ where: {
      action: "VENUE_LOAN_CAPTURE_CANCELLED", table_name: "venue_loans", entity_id: data.requestId,
    }, select: { user_id: true } });
    if (prior && prior.user_id !== actor) throw new AuthorizationError();
    if (!prior) await tx.audit_logs.create({ data: {
      user_id: actor, action: "VENUE_LOAN_CAPTURE_CANCELLED", table_name: "venue_loans",
      entity_id: data.requestId, reason: "Reinicio de captura anterior sin firma",
    } });
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: data.seasonId }, select: { league_id: true } });
    const cleanup = await tx.audit_logs.findFirst({ where: {
      action: "VENUE_LOAN_CLEANUP_SCHEDULED", table_name: "venue_loans", entity_id: data.requestId,
    }, select: { id: true } });
    if (!cleanup) await tx.audit_logs.create({ data: {
      user_id: actor, action: "VENUE_LOAN_CLEANUP_SCHEDULED", table_name: "venue_loans",
      entity_id: data.requestId, reason: "Limpieza recuperable de captura cancelada",
      new_data: { leagueId: season.league_id, seasonId: data.seasonId, clubId: data.clubId },
    } });
    return { outcome: "cancelled" as const, id: data.requestId, leagueId: season.league_id };
  });
  if (result.outcome === "cancelled") {
    const transport = storage ?? createVenueLoanLetterStorage();
    if (!transport.remove) throw new Error("VENUE_LOAN_CLEANUP_UNAVAILABLE");
    await transport.remove(`${VENUE_LOAN_LETTER_PREFIX}/v1/${result.leagueId}/${data.seasonId}/${data.clubId}/${actor}/${data.requestId}`);
    return { outcome: result.outcome, id: result.id };
  }
  return result;
}

export async function decideVenueLoan(input: unknown) {
  const { id: actor } = await requireOperationalUser();
  return decideVenueLoanForActor(actor, input);
}

export async function decideVenueLoanForActor(actor: string, input: unknown) {
  const data = decisionSchema.parse(input);
  return getPrisma().$transaction(async tx => {
    // Mismo orden que generación y ajustes: autorización, temporada, solicitud.
    await lockAuthorization(tx);
    const scope = await tx.venue_loans.findUnique({where:{id:data.requestId},select:{season_id:true}});
    if (!scope) throw new AuthorizationError();
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${scope.season_id}::uuid FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.requestId}, 2301))`;
    const row = await tx.venue_loans.findUnique({ where: { id: data.requestId }, select: {
      id: true, club_id: true, season_id: true, requested_by: true, status: true,
      reviewed_by: true, review_reason: true, owner_decision_required: true, owner_decision: true,
      owner_reviewed_by: true, owner_review_reason: true, venues: { select: { owner_club_id: true } },
      seasons: { select: { status: true } },
    } });
    if (!row?.requested_by) throw new AuthorizationError();
    if (row.requested_by === actor) throw new AuthorizationError();
    if (row.owner_decision_required && !row.owner_decision) {
      if (!row.venues.owner_club_id) throw new AuthorizationError();
      await authorize(tx, actor, "CREATE", { clubId: row.venues.owner_club_id, seasonId: row.season_id });
      if (row.status !== "PENDING" || row.seasons.status === "CLOSED") throw new LoanError("REQUEST_NOT_PENDING");
      await auditContext(tx, actor, data.reason);
      await tx.venue_loans.update({ where: { id: row.id }, data: { owner_decision: data.status, owner_reviewed_by: actor,
        owner_reviewed_at: new Date(), owner_review_reason: data.reason, ...(data.status === "REJECTED" ? { status: "REJECTED" } : {}) } });
      return { id: row.id, status: data.status === "REJECTED" ? "REJECTED" : "PENDING" };
    }
    if (row.owner_decision_required && row.owner_decision === data.status && row.owner_reviewed_by === actor && row.owner_review_reason === data.reason)
      return { id: row.id, status: row.status };
    if (row.owner_decision_required && row.owner_decision !== "APPROVED") throw new LoanError("REQUEST_NOT_PENDING");
    await authorize(tx, actor, "APPROVE", { clubId: row.club_id, seasonId: row.season_id });
    if (row.status === data.status && row.reviewed_by === actor && row.review_reason === data.reason) {
      return { id: row.id, status: row.status };
    }
    if (row.status !== "PENDING" || row.seasons.status === "CLOSED") throw new LoanError("REQUEST_NOT_PENDING");
    const now = new Date();
    await auditContext(tx, actor, data.reason);
    const updated = await tx.venue_loans.updateMany({ where: { id: row.id, status: "PENDING" }, data: {
      status: data.status, reviewed_by: actor, reviewed_at: now, review_reason: data.reason,
      approved_by: data.status === "APPROVED" ? actor : null,
      approved_at: data.status === "APPROVED" ? now : null,
    } });
    if (!updated.count) throw new LoanError("REQUEST_NOT_PENDING");
    return { id: row.id, status: data.status };
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function previewVenueLoanLetter(value: unknown, storage?: PrivateDocumentTransport) {
  const { id: actor } = await requireOperationalUser();
  return previewVenueLoanLetterForActor(actor, value, storage);
}

export async function previewVenueLoanLetterForActor(actor: string, value: unknown, storage?: PrivateDocumentTransport) {
  const id = z.uuid().parse(value);
  const load = () => getPrisma().$transaction(async tx => {
    const row = await tx.venue_loans.findUnique({ where: { id }, select: {
      club_id: true, season_id: true, requested_by: true, owner_decision_required: true, owner_decision: true,
      venues: { select: { owner_club_id: true } }, files: { select: {
        id: true, storage_key: true, mime_type: true, size_bytes: true, sha256: true,
      } },
    } });
    if (!row?.requested_by) throw new AuthorizationError();
    if (row.requested_by === actor) await authorize(tx, actor, "CREATE", { clubId: row.club_id, seasonId: row.season_id });
    else if (row.owner_decision_required && !row.owner_decision && row.venues.owner_club_id)
      await authorize(tx, actor, "CREATE", { clubId: row.venues.owner_club_id, seasonId: row.season_id });
    else await authorize(tx, actor, "APPROVE", { clubId: row.club_id, seasonId: row.season_id });
    return row.files;
  });
  const file = await load();
  const transport = storage ?? createVenueLoanLetterStorage();
  const bytes = await transport.read(file.storage_key, PRIVATE_FILE_MAX_BYTES, file.mime_type);
  if (BigInt(bytes.byteLength) !== file.size_bytes || sha256(bytes) !== file.sha256) throw new LoanError("LETTER_MISMATCH");
  const access = await transport.createDownloadUrl(file.storage_key);
  const current = await load();
  if (current.id !== file.id || current.sha256 !== file.sha256) throw new AuthorizationError();
  return { ...access, mimeType: file.mime_type };
}
