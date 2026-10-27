import { NextResponse } from "next/server";
import { enrollTeam } from "@/features/clubs/server/team-enrollment-service";
import { listTeamEnrollments } from "@/features/clubs/server/team-enrollment-queries";
import { enrollmentFailure, enrollmentHeaders, enrollmentQuery, readEnrollmentBody } from "@/features/clubs/server/team-enrollment-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await listTeamEnrollments(enrollmentQuery(request)), { headers: enrollmentHeaders });
  } catch (error) { return enrollmentFailure(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readEnrollmentBody(request);
    if (body instanceof Response) return body;
    const result = await enrollTeam(body, request.headers.get("x-expected-actor-id") ?? undefined);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: enrollmentHeaders });
  } catch (error) { return enrollmentFailure(error); }
}
