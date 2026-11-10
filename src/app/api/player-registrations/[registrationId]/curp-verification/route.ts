import { NextResponse } from "next/server";
import { getPlayerCurpStatus, verifyPlayerCurp } from "@/features/players/server/curp-verification-service";
import { curpVerificationFailure, curpVerificationHeaders, readCurpVerificationBody } from "@/features/players/server/curp-verification-http";
import { CurpVerificationError } from "@/features/players/server/curp-check-record";

export const runtime = "nodejs";
type Context = { params: Promise<{ registrationId: string }> };

/** Solo consulta nuestro registro: nunca contacta Verificamex. */
export async function GET(request: Request, context: Context) {
  try {
    const query = [...new URL(request.url).searchParams.entries()];
    if (query.length > 1 || query.some(([key]) => key !== "checkId")) throw new CurpVerificationError("VALIDATION_ERROR", 400);
    return NextResponse.json(await getPlayerCurpStatus((await context.params).registrationId, query[0]?.[1], request.headers.get("X-Expected-Actor-Id") ?? undefined),
      { headers: curpVerificationHeaders });
  } catch (error) { return curpVerificationFailure(error); }
}

/** La vista futura invoca POST únicamente mediante una acción humana explícita. */
export async function POST(request: Request, context: Context) {
  try {
    const input = await readCurpVerificationBody(request);
    if (input instanceof Response) return input;
    return NextResponse.json(await verifyPlayerCurp((await context.params).registrationId, input, request.headers.get("X-Expected-Actor-Id") ?? undefined),
      { headers: curpVerificationHeaders });
  } catch (error) { return curpVerificationFailure(error); }
}
