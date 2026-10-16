import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { z } from "zod";
import { getAuthOptions } from "@/server/auth/options";
import { validatePersistentSession } from "@/server/auth/session-store";

export const runtime = "nodejs";

const activityTokenSchema = z.object({
  sub: z.uuid(),
  userVersion: z.number().int().positive(),
  sid: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  exp: z.number().int().positive(),
});

function reply(body: object, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const configuredUrl = process.env.NEXTAUTH_URL;

    if (!configuredUrl) {
      return reply({ code: "SERVICE_UNAVAILABLE" }, 503);
    }

    const expectedOrigin = new URL(configuredUrl).origin;

    // Este endpoint exige una petición explícita del mismo origen.
    if (
      request.headers.get("origin") !== expectedOrigin ||
      request.headers.get("x-session-activity") !== "interaction"
    ) {
      return reply({ code: "FORBIDDEN" }, 403);
    }

    // Solo autenticar mediante la cookie HttpOnly de NextAuth.
    if (request.headers.has("authorization")) {
      return reply({ code: "UNAUTHORIZED" }, 401);
    }

    const options = getAuthOptions();

    const token = await getToken({
      req: request,
      secret: options.secret,
    });

    const parsed = activityTokenSchema.safeParse(token);

    if (!parsed.success) {
      return reply({ code: "UNAUTHORIZED" }, 401);
    }

    // No aceptar el margen de tolerancia del decodificador
    // como permiso para renovar un JWT ya vencido.
    if (parsed.data.exp * 1000 <= Date.now()) {
      return reply({ code: "UNAUTHORIZED" }, 401);
    }

    const session = await validatePersistentSession(
      parsed.data.sid,
      parsed.data.sub,
      parsed.data.userVersion,
      { touch: true },
    );

    if (!session) {
      return reply({ code: "UNAUTHORIZED" }, 401);
    }

    return reply(
      {
        ok: true,
        expiresAt: session.expiresAt.toISOString(),
      },
      200,
    );
  } catch {
    console.error("[auth] SESSION_ACTIVITY_UNAVAILABLE");

    return reply({ code: "SERVICE_UNAVAILABLE" }, 503);
  }
}