import "server-only";
import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getAuthOptions } from "./options";
import { refreshIdentityToken } from "./token";

/** Private cookie identity for writes; never part of the public session DTO. */
export async function getPrivateRequestIdentity(request: Request) {
  try {
    // Ignore Authorization: this entry uses the same HttpOnly cookie as NextAuth.
    const cookieRequest = new NextRequest(request.url, { headers: { cookie: request.headers.get("cookie") ?? "" } });
    const token = await getToken({ req: cookieRequest, secret: getAuthOptions().secret });
    if (!token) return null;
    const current = await refreshIdentityToken(token);
    if (typeof current.sub !== "string" || typeof current.userVersion !== "number") return null;
    return { id: current.sub, userVersion: current.userVersion };
  } catch {
    console.error("[auth] REQUEST_IDENTITY_UNAVAILABLE");
    return null;
  }
}
