import "server-only";
import { NextResponse } from "next/server";
import { AffiliationInputError } from "./affiliation-service";
import { AffiliationReviewError } from "./affiliation-review-service";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";

const headers = { "Cache-Control": "private, no-store" };
export async function affiliationResponse(operation: () => Promise<unknown>) {
  try { return NextResponse.json(await operation(), { headers }); }
  catch (error) {
    if (error instanceof AffiliationInputError || error instanceof AffiliationReviewError ||
        error instanceof AuthAccessError || error instanceof AuthorizationError)
      return NextResponse.json({ code: error.code }, { status: error.status, headers });
    console.error("[affiliations] SERVICE_UNAVAILABLE");
    return NextResponse.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}
export async function affiliationBody(request: Request) {
  if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL ?? request.url).origin ||
      request.headers.get("sec-fetch-site") === "cross-site")
    throw new AffiliationReviewError("INVALID_ORIGIN", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    throw new AffiliationReviewError("INVALID_PAYLOAD");
  const reader = request.body?.getReader();
  if (!reader) throw new AffiliationReviewError("INVALID_PAYLOAD");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new AffiliationReviewError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof AffiliationReviewError) throw error;
    throw new AffiliationReviewError("INVALID_PAYLOAD");
  } finally { reader.releaseLock(); }
}
