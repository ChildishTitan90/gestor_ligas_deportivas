import { NextResponse } from "next/server";
import { getTeamEnrollmentOptions } from "@/features/clubs/server/team-enrollment-queries";
import { enrollmentFailure, enrollmentHeaders, enrollmentQuery } from "@/features/clubs/server/team-enrollment-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getTeamEnrollmentOptions(enrollmentQuery(request)), { headers: enrollmentHeaders });
  } catch (error) { return enrollmentFailure(error); }
}
