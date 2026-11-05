import { NextResponse } from "next/server";
import { registerAndVerifyPlayer } from "@/features/players/server/registration-intake";
import { listRegisteredPlayers } from "@/features/players/server/workspace-queries";
import { playerFailure, playerHeaders, readPlayerBody } from "@/features/players/server/player-http";
import { PlayerRegistrationError } from "@/features/players/server/access";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const entries = [...new URL(request.url).searchParams.entries()];
    if (entries.length > 1 || (entries.length===1 && entries[0][0] !== "seasonTeamId")) throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
    return NextResponse.json(await listRegisteredPlayers(entries[0]?.[1], request.headers.get("X-Expected-Actor-Id") ?? undefined), { headers: playerHeaders });
  } catch (error) { return playerFailure(error); }
}
export async function POST(request: Request) {
  try {
    const input = await readPlayerBody(request);
    if (input instanceof Response) return input;
    return NextResponse.json(await registerAndVerifyPlayer(input, request.headers.get("x-expected-actor-id") ?? undefined), { headers: playerHeaders });
  } catch (error) { return playerFailure(error); }
}
