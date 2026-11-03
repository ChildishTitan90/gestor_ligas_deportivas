import "server-only";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { CompetitionError } from "./configuration";

export const competitionHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
export function competitionFailure(error: unknown) {
  if (error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof CompetitionError)
    return Response.json({ code: error.code }, { status: error.status, headers: competitionHeaders });
  return Response.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers: competitionHeaders });
}
export async function readCompetitionBody(request: Request): Promise<unknown> {
  let origin: string;
  try { origin = new URL(process.env.NEXTAUTH_URL ?? "").origin; }
  catch { throw new CompetitionError("SERVICE_UNAVAILABLE", 503); }
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site")
    throw new CompetitionError("INVALID_ORIGIN", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    throw new CompetitionError("INVALID_PAYLOAD");
  const reader = request.body?.getReader();
  if (!reader) throw new CompetitionError("INVALID_PAYLOAD");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 32768) { await reader.cancel(); throw new CompetitionError("PAYLOAD_TOO_LARGE", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new CompetitionError("INVALID_PAYLOAD"); }
}
