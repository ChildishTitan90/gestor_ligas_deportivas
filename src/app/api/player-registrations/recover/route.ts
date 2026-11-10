import { NextResponse } from "next/server";
import { recoverPlayerRegistration } from "@/features/players/server/workspace-queries";
import { playerFailure, playerHeaders, readPlayerBody } from "@/features/players/server/player-http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = await readPlayerBody(request);
    if (input instanceof Response) return input;
    return NextResponse.json(await recoverPlayerRegistration(input, request.headers.get("x-expected-actor-id") ?? undefined), { headers: playerHeaders });
  } catch (error) { return playerFailure(error); }
}
