import { NextResponse } from "next/server";
import { updatePlayerJerseyNumber } from "@/features/players/server/jersey-number";
import { playerFailure, playerHeaders, readPlayerBody } from "@/features/players/server/player-http";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ registrationId: string }> }) {
  try {
    const input = await readPlayerBody(request);
    if (input instanceof Response) return input;
    const { registrationId } = await params;
    return NextResponse.json(await updatePlayerJerseyNumber(registrationId, input,
      request.headers.get("x-expected-actor-id") ?? undefined), { headers: playerHeaders });
  } catch (error) { return playerFailure(error); }
}
