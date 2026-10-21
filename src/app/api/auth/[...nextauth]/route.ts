import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthOptions } from "@/server/auth/options";

export const runtime = "nodejs";

async function handle(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  const options = getAuthOptions();
  const originalSignOut = options.events?.signOut;
  let revocationFailed = false;

  options.events = {
    ...options.events,
    async signOut(message) {
      try {
        await originalSignOut?.(message);
      } catch {
        revocationFailed = true;
        console.error("SESSION_SIGNOUT_REVOCATION_FAILED");
      }
    },
  };

  const response = await NextAuth(options)(request, context);

  if (revocationFailed) {
    return NextResponse.json(
      { error: "SIGNOUT_FAILED" },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }

  return response;
}

export { handle as GET, handle as POST };