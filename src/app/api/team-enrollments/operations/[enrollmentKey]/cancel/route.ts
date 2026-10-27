import { NextResponse } from "next/server";
import { cancelTeamEnrollment } from "@/features/clubs/server/team-enrollment-operations";
import { enrollmentCancellationSchema } from "@/features/clubs/team-enrollment";
import { enrollmentFailure, enrollmentHeaders, readEnrollmentBody } from "@/features/clubs/server/team-enrollment-http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ enrollmentKey: string }> }) {
  try {
    const body = await readEnrollmentBody(request);
    if (body instanceof Response) return body;
    const { enrollmentKey } = await context.params;
    const parsed = enrollmentCancellationSchema.safeParse(body);
    if (!parsed.success || parsed.data.enrollmentKey !== enrollmentKey.toLowerCase())
      return NextResponse.json({ code: "VALIDATION_ERROR" }, { status: 400, headers: enrollmentHeaders });
    return NextResponse.json(await cancelTeamEnrollment(parsed.data, request.headers.get("x-expected-actor-id") ?? undefined), { headers: enrollmentHeaders });
  } catch (error) { return enrollmentFailure(error); }
}
