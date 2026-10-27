import { NextResponse } from "next/server";
import { getTeamEnrollmentOperation } from "@/features/clubs/server/team-enrollment-operations";
import { enrollmentFailure, enrollmentHeaders, enrollmentQuery } from "@/features/clubs/server/team-enrollment-http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ enrollmentKey: string }> }) {
  try {
    const { enrollmentKey } = await context.params;
    const query = enrollmentQuery(request);
    // No permitir que el query reemplace la clave de la ruta.
    if ("enrollmentKey" in query) return NextResponse.json({ code: "VALIDATION_ERROR" }, { status: 400, headers: enrollmentHeaders });
    return NextResponse.json(await getTeamEnrollmentOperation({ ...query, enrollmentKey }, request.headers.get("x-expected-actor-id") ?? undefined), { headers: enrollmentHeaders });
  } catch (error) { return enrollmentFailure(error); }
}
