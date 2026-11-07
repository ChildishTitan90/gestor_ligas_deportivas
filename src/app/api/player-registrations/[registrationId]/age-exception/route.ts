import { NextResponse } from "next/server";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { readAgeExceptionForActor, recoverAgeExceptionForActor, actOnAgeExceptionForActor } from "@/features/players/server/age-exception-service";
import { playerFailure, playerHeaders, readPlayerBody } from "@/features/players/server/player-http";
import { PlayerRegistrationError } from "@/features/players/server/access";

export const runtime = "nodejs";
type Context = { params: Promise<{ registrationId: string }> };
async function actorFor(request: Request) {
  const actor = await requireOperationalUser();
  const expected = request.headers.get("x-expected-actor-id");
  if (expected && actor.id !== expected.toLowerCase()) throw new AuthorizationError();
  return actor;
}
export async function GET(request: Request, context: Context) {
  try {
    const actor = await actorFor(request), { registrationId } = await context.params;
    const entries = [...new URL(request.url).searchParams.entries()];
    if (entries.length > 1 || entries.length === 1 && entries[0][0] !== "operationKey") throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
    const data = entries.length ? await recoverAgeExceptionForActor(actor.id, registrationId, entries[0][1]) : await readAgeExceptionForActor(actor.id, registrationId);
    return NextResponse.json(data, { headers: playerHeaders });
  } catch (error) { return playerFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const input = await readPlayerBody(request, 8192);
    if (input instanceof Response) return input;
    const actor = await actorFor(request);
    return NextResponse.json(await actOnAgeExceptionForActor(actor.id, (await context.params).registrationId, input), { headers: playerHeaders });
  } catch (error) { return playerFailure(error); }
}
