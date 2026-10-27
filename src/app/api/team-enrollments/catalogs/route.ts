import { NextResponse } from "next/server";
import { getTeamEnrollmentCatalogs } from "@/features/clubs/server/team-enrollment-queries";
import { enrollmentFailure, enrollmentHeaders, enrollmentQuery } from "@/features/clubs/server/team-enrollment-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getTeamEnrollmentCatalogs(enrollmentQuery(request)), { headers: enrollmentHeaders });
  } catch (error) { return enrollmentFailure(error); }
}
