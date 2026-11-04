import { NextResponse } from "next/server";
import { getDelegateAssignmentOptions } from "@/features/accounts/server/delegate-options";
import { AccountInputError } from "@/features/accounts/account-errors";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const result = await getDelegateAssignmentOptions({ leagueId: params.get("leagueId"),
      club: params.get("clubKind") === "new" ? { kind: "new" } : { kind: params.get("clubKind"), id: params.get("clubId") },
      ...(params.has("startsAt") || params.has("endsAt") ? { period: {
        startsAt: params.get("startsAt"), endsAt: params.get("endsAt") || null,
      } } : {}) });
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof AccountInputError)
      return NextResponse.json({ code: error.code }, { status: error.status, headers });
    console.error("[delegate-options] SERVICE_UNAVAILABLE");
    return NextResponse.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}
