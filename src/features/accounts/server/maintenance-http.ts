import "server-only";
import { NextResponse } from "next/server";
import { AccountMaintenanceError } from "../maintenance-contract";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
export const maintenanceHeaders = { "Cache-Control": "private, no-store" };
export function maintenanceFailure(error: unknown) {
  if (error instanceof AccountMaintenanceError || error instanceof AuthAccessError || error instanceof AuthorizationError)
    return NextResponse.json({ code: error.code }, { status: error.status, headers: maintenanceHeaders });
  console.error("[account-maintenance] SERVICE_UNAVAILABLE");
  return NextResponse.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers: maintenanceHeaders });
}
export async function readStatusBody(request: Request) {
  if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL ?? request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site") throw new AccountMaintenanceError("INVALID_ORIGIN", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    throw new AccountMaintenanceError("INVALID_PAYLOAD");
  const reader = request.body?.getReader();
  if (!reader) throw new AccountMaintenanceError("INVALID_PAYLOAD");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new AccountMaintenanceError("PAYLOAD_TOO_LARGE", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new AccountMaintenanceError("INVALID_PAYLOAD"); }
}
