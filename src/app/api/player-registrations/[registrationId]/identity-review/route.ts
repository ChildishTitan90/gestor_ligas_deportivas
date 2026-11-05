import { NextResponse } from "next/server";
import { decideIdentityReview } from "@/features/players/server/identity-review";
import { playerFailure,playerHeaders,readPlayerBody } from "@/features/players/server/player-http";
export async function POST(request:Request,context:{params:Promise<{registrationId:string}>}) {
  try {
    const input=await readPlayerBody(request);
    if(input instanceof Response)return input;
    return NextResponse.json(await decideIdentityReview((await context.params).registrationId,input,request.headers.get("X-Expected-Actor-Id") ?? undefined),{headers:playerHeaders});
  }catch(error){return playerFailure(error);}
}
