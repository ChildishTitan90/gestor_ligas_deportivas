import "server-only";

import { requireOperationalUser, AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { SignatureAccessError } from "./signature-access";
import { SignatureValidationError } from "./signature-validation";
import { SignatureUploadTicketError } from "./signature-upload-ticket";
import { SignatureServiceError } from "./signature-service";
import { SignatureStorageError } from "./supabase-signature-storage";

export const signatureResponseHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie",
};

export class SignatureHttpError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

export async function readSignatureJson(
  request: Request,
): Promise<unknown> {
  let expectedOrigin: string;

  try {
    expectedOrigin = new URL(process.env.NEXTAUTH_URL ?? "").origin;
  } catch {
    throw new SignatureHttpError("SERVICE_UNAVAILABLE", 503);
  }

  if (
    request.headers.get("origin") !== expectedOrigin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new SignatureHttpError("INVALID_ORIGIN", 403);
  }

  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    throw new SignatureHttpError("INVALID_PAYLOAD", 400);
  }

  await requireOperationalUser();

  const reader = request.body?.getReader();

  if (!reader) {
    throw new SignatureHttpError("INVALID_PAYLOAD", 400);
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      size += value.byteLength;

      if (size > 8192) {
        await reader.cancel().catch(() => undefined);
        throw new SignatureHttpError("PAYLOAD_TOO_LARGE", 413);
      }

      chunks.push(value);
    }

    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof SignatureHttpError) throw error;

    throw new SignatureHttpError("INVALID_PAYLOAD", 400);
  } finally {
    reader.releaseLock();
  }
}

export function signatureErrorResponse(error: unknown): Response {
  if (
    error instanceof AuthAccessError ||
    error instanceof AuthorizationError ||
    error instanceof SignatureAccessError ||
    error instanceof SignatureValidationError ||
    error instanceof SignatureUploadTicketError ||
    error instanceof SignatureServiceError ||
    error instanceof SignatureStorageError ||
    error instanceof SignatureHttpError
  ) {
    return Response.json(
      { code: error.code },
      { status: error.status, headers: signatureResponseHeaders },
    );
  }

  // No registrar cuerpos, credenciales ni enlaces firmados.
  console.error("[signatures] SERVICE_UNAVAILABLE");

  return Response.json(
    { code: "SERVICE_UNAVAILABLE" },
    { status: 503, headers: signatureResponseHeaders },
  );
}