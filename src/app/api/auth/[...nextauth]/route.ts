import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { getAuthOptions } from "@/server/auth/options";

export const runtime = "nodejs";

async function handle(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  return NextAuth(getAuthOptions())(request, context);
}

export { handle as GET, handle as POST };
