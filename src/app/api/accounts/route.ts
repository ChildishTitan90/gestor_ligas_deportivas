import { NextResponse } from "next/server";
import { AccountInputError, createAccount, getAccountCreationOptions } from "@/features/accounts/server/service";
import { AccountAccessError } from "@/server/auth/account-administrator";
import { AuthAccessError } from "@/server/auth/session";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

function failure(error: unknown) {
  if (error instanceof AuthAccessError) return NextResponse.json({ code: error.code }, { status: error.status, headers });
  if (error instanceof AccountAccessError) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403, headers });
  if (error instanceof AccountInputError) return NextResponse.json({ code: error.code }, { status: error.status, headers });
  console.error("[accounts] SERVICE_UNAVAILABLE");
  return NextResponse.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
}

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getAccountCreationOptions(new URL(request.url).searchParams.get("leagueId") ?? undefined), { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  // Endpoint JSON para UI del mismo origen. No habilitar CORS ni autorregistro.
  // Next puede reconstruir request.url con localhost detrás del servidor/proxy.
  // NEXTAUTH_URL es el origen público configurado, no un encabezado del cliente.
  if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL ?? request.url).origin ||
      request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403, headers });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ code: "INVALID_PAYLOAD" }, { status: 400, headers });
  }
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
      if (size > 16_384) {
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
    return NextResponse.json(await createAccount(body), { status: 201, headers });
  } catch (error) { return failure(error); }
}

