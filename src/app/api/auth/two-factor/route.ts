import { NextResponse } from "next/server";
import { twoFactorCommand } from "@/features/auth/two-factor-contract";
import { executeTwoFactor } from "@/server/auth/two-factor";
import { getPrivateRequestIdentity } from "@/server/auth/request-identity";
import { readRecoveryBody } from "@/server/auth/recovery-http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const parsed = twoFactorCommand.safeParse(
    await readRecoveryBody(request).catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { code: "INVALID_REQUEST" },
      { status: 400, headers },
    );
  const identity = await getPrivateRequestIdentity(request, true);
  if (!identity)
    return NextResponse.json(
      { code: "UNAUTHENTICATED" },
      { status: 401, headers },
    );
  try {
    const { status, ...body } = await executeTwoFactor(identity, parsed.data);
    return NextResponse.json(body, { status, headers });
  } catch {
    console.error("[auth] MFA_UNAVAILABLE");
    return NextResponse.json({ code: "UNAVAILABLE" }, { status: 503, headers });
  }
}
