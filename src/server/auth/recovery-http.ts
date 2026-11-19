import "server-only";
import { NextResponse } from "next/server";

export function recoveryResponse(code: string, status = 200) {
  return NextResponse.json({ code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readRecoveryBody(request: Request): Promise<unknown> {
  const configured = new URL(process.env.NEXTAUTH_URL ?? "");
  if (!["https:", "http:"].includes(configured.protocol) || configured.username || configured.password ||
      request.headers.get("origin") !== configured.origin || request.headers.get("sec-fetch-site") === "cross-site" ||
      request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw Error("INVALID_REQUEST");
  const reader = request.body?.getReader();
  if (!reader) throw Error("INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw Error("INVALID_REQUEST"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
