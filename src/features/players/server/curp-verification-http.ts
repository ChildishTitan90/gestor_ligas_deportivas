import "server-only";
import { NextResponse } from "next/server";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { CurpVerificationError } from "./curp-check-record";

export const curpVerificationHeaders = { "Cache-Control": "private, no-store" };
export function curpVerificationFailure(error: unknown) {
  if (error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof CurpVerificationError)
    return NextResponse.json({ code: error.code }, { status: error.status, headers: curpVerificationHeaders });
  // Nunca imprimir errores de proveedor, credenciales, payloads o datos de identidad.
  return NextResponse.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers: curpVerificationHeaders });
}

export async function readCurpVerificationBody(request: Request, maximumBytes = 2048): Promise<unknown> {
  const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: curpVerificationHeaders });
  if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL ?? request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site") return fail("INVALID_ORIGIN", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return fail("INVALID_PAYLOAD", 400);
  const reader = request.body?.getReader();
  if (!reader) return fail("INVALID_PAYLOAD", 400);
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) { await reader.cancel(); return fail("PAYLOAD_TOO_LARGE", 413); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return fail("INVALID_PAYLOAD", 400); }
}
