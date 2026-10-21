import { NextResponse } from "next/server";
import { changePermissionAssignment, getPermissionAssignments, PermissionAdministrationError } from "@/features/permissions/server/service";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

function failure(error: unknown) {
  if (error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof PermissionAdministrationError)
    return NextResponse.json({ code: error.code }, { status: error.status, headers });
  console.error("[permissions] SERVICE_UNAVAILABLE");
  return NextResponse.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "roleCode") || params.getAll("roleCode").length > 1)
    return NextResponse.json({ code: "VALIDATION_ERROR" }, { status: 400, headers });
  try {
    return NextResponse.json(await getPermissionAssignments(params.get("roleCode") ?? undefined), { headers });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL ?? request.url).origin ||
      request.headers.get("sec-fetch-site") === "cross-site")
    return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403, headers });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return NextResponse.json({ code: "INVALID_PAYLOAD" }, { status: 400, headers });
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("EMPTY_BODY");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8_192) {
        await reader.cancel();
        return NextResponse.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413, headers });
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return NextResponse.json({ code: "INVALID_PAYLOAD" }, { status: 400, headers });
  }
  try {
    return NextResponse.json(await changePermissionAssignment(body), { headers });
  } catch (error) { return failure(error); }
}
