import "server-only";
import { NextResponse } from "next/server";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { TeamEnrollmentError } from "./team-enrollment-access";

export const enrollmentHeaders = { "Cache-Control": "private, no-store" };

export function enrollmentFailure(error: unknown) {
  if (error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof TeamEnrollmentError)
    return NextResponse.json({ code: error.code }, { status: error.status, headers: enrollmentHeaders });
  console.error("[team-enrollments] SERVICE_UNAVAILABLE");
  return NextResponse.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers: enrollmentHeaders });
}

export function enrollmentQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const entries = [...params.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new TeamEnrollmentError("VALIDATION_ERROR");
  return Object.fromEntries(entries);
}

export async function readEnrollmentBody(request: Request): Promise<unknown | Response> {
  const fail = (code: string, status: number) => NextResponse.json({ code }, { status, headers: enrollmentHeaders });
  if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL ?? request.url).origin ||
      request.headers.get("sec-fetch-site") === "cross-site") return fail("INVALID_ORIGIN", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return fail("INVALID_PAYLOAD", 400);
  try {
    const reader = request.body?.getReader();
    if (!reader) return fail("INVALID_PAYLOAD", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return fail("PAYLOAD_TOO_LARGE", 413); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return fail("INVALID_PAYLOAD", 400); }
}
