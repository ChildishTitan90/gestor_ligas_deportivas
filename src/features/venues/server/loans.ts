import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { PRIVATE_FILE_MAX_BYTES, validatePrivateFileContent } from "@/server/files/private-file-validation";
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
      OR: [{ owner_club_id: null }, { owner_club_id: data.clubId }] }, select: { id: true },
  });
  if (!venue) throw new AuthorizationError();
  return season;
}

async function auditContext(tx: Tx, actor: string, reason: string) {
  await tx.$queryRaw`SELECT set_config('app.user_id', ${actor}, true), set_config('app.reason', ${reason}, true)`;
}

export async function submitVenueLoan(input: unknown, attachment: { bytes: Uint8Array; mimeType: string }, storage?: PrivateDocumentTransport) {
  const { id: actor } = await requireOperationalUser();
  return submitVenueLoanForActor(actor, input, attachment, storage);
}

export async function submitVenueLoanForActor(actor: string, input: unknown, attachment: { bytes: Uint8Array; mimeType: string }, storage?: PrivateDocumentTransport) {
  const data = requestSchema.parse(input);
  const windows = data.windows.map(w => ({
    startsAt: new Date(w.startsAt).toISOString(), endsAt: new Date(w.endsAt).toISOString(),
  })).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (windows.some((w, i) => w.startsAt >= w.endsAt || (i > 0 && windows[i - 1].endsAt > w.startsAt))) {
    throw new LoanError("INVALID_WINDOWS");
  }
  const file = await validatePrivateFileContent(attachment.bytes, attachment.mimeType);
  const hash = sha256(JSON.stringify({ ...data, windows, file: file.sha256 }));
  const db = getPrisma();
  const check = async (tx: Tx) => {
    const season = await requestContext(tx, actor, data);
    const existing = await tx.venue_loans.findUnique({ where: { id: data.requestId },
      select: { ...receipt, requested_by: true, request_hash: true } });
    if (existing) {
      if (existing.requested_by !== actor || existing.request_hash !== hash) throw new LoanError("REQUEST_CONFLICT");
      return { receipt: { id: existing.id, status: existing.status }, objectKey: null };
    }
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
  await transport.put(prepared.objectKey, file);
  const stored = await transport.read(prepared.objectKey, PRIVATE_FILE_MAX_BYTES, file.mimeType);
  if (stored.byteLength !== file.sizeBytes || sha256(stored) !== file.sha256) throw new LoanError("LETTER_MISMATCH");

  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.requestId}, 2301))`;
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
      letter_file_id: letter.id, requested_by: actor, request_hash: hash, requested_windows: windows,
    }, select: receipt });
  });
}

export async function decideVenueLoan(input: unknown) {
  const { id: actor } = await requireOperationalUser();
  return decideVenueLoanForActor(actor, input);
}

export async function decideVenueLoanForActor(actor: string, input: unknown) {
  const data = decisionSchema.parse(input);
  return getPrisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.requestId}, 2301))`;
    const row = await tx.venue_loans.findUnique({ where: { id: data.requestId }, select: {
      id: true, club_id: true, season_id: true, requested_by: true, status: true,
      reviewed_by: true, review_reason: true, seasons: { select: { status: true } },
    } });
    if (!row?.requested_by) throw new AuthorizationError();
    await authorize(tx, actor, "APPROVE", { clubId: row.club_id, seasonId: row.season_id });
    if (row.requested_by === actor) throw new AuthorizationError();
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
  });
}

export async function previewVenueLoanLetter(value: unknown, storage?: PrivateDocumentTransport) {
  const { id: actor } = await requireOperationalUser();
  return previewVenueLoanLetterForActor(actor, value, storage);
}

export async function previewVenueLoanLetterForActor(actor: string, value: unknown, storage?: PrivateDocumentTransport) {
  const id = z.uuid().parse(value);
  const load = () => getPrisma().$transaction(async tx => {
    const row = await tx.venue_loans.findUnique({ where: { id }, select: {
      club_id: true, season_id: true, requested_by: true, files: { select: {
        id: true, storage_key: true, mime_type: true, size_bytes: true, sha256: true,
      } },
    } });
    if (!row?.requested_by) throw new AuthorizationError();
    await authorize(tx, actor, row.requested_by === actor ? "CREATE" : "APPROVE",
      { clubId: row.club_id, seasonId: row.season_id });
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
