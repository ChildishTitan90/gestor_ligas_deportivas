import "server-only";
import { NextResponse } from "next/server";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { PlayerRegistrationError } from "./access";
import { readCurpVerificationBody } from "./curp-verification-http";

export const playerHeaders = { "Cache-Control": "private, no-store" };
export const readPlayerBody = readCurpVerificationBody;
export function playerFailure(error: unknown) {
  if (error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof PlayerRegistrationError)
    return NextResponse.json({ code: error.code, ...(error instanceof PlayerRegistrationError && error.rule ? {rule:error.rule}:{}) }, { status: error.status, headers: playerHeaders });
  return NextResponse.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers: playerHeaders });
}
