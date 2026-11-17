import "server-only";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { ReportError } from "../contract";
import { BinaryFileValidationError } from "@/server/files/private-file-validation";
import { PrivateDocumentStorageError } from "@/server/files/private-document-storage";

export function reportHttpError(error: unknown) {
  if (error instanceof ReportError || error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof BinaryFileValidationError || error instanceof PrivateDocumentStorageError) return Response.json({ code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  console.error("[match-reports] OPERATION_UNAVAILABLE");
  return Response.json({ code: "OPERATION_UNAVAILABLE" }, { status: 503 });
}
export async function readReportBody(request: Request, actorId: string, max = 250000) {
  if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL ?? request.url).origin || request.headers.get("sec-fetch-site") === "cross-site" || request.headers.get("X-Expected-Actor-Id") !== actorId) throw new AuthorizationError();
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ReportError("INVALID_PAYLOAD", 400);
  const reader = request.body?.getReader(); if (!reader) throw new ReportError("INVALID_PAYLOAD", 400);
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > max) { await reader.cancel(); throw new ReportError("PAYLOAD_TOO_LARGE", 413); } chunks.push(value); } } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new ReportError("INVALID_PAYLOAD", 400); }
}
