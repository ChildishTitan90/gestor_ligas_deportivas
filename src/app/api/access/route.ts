import { getAccessIdentity } from "@/features/auth/server/queries";
import { AuthAccessError } from "@/server/auth/session";

export const runtime = "nodejs";

/** Prueba de integración de identidad; no concede permisos administrativos. */
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return Response.json({ user: await getAccessIdentity() }, { headers });
  } catch (error) {
    if (error instanceof AuthAccessError) {
      return Response.json({ error: error.code }, { status: error.status, headers });
    }
    return Response.json({ error: "AUTH_UNAVAILABLE" }, { status: 503, headers });
  }
}
