import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
import { generateSchedule, SchedulingError } from "@/features/scheduling/server/service";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";

export async function POST(request: Request) {
  try {
    const actor = await requireOperationalUser();
    if (request.headers.get("X-Expected-Actor-Id") !== actor.id) throw new AuthorizationError();
    const result = await generateSchedule(await readCompetitionBody(request));
    return Response.json(result, { headers: competitionHeaders });
  } catch (error) {
    if (error instanceof SchedulingError) return Response.json({ code: error.code }, { status: error.status, headers: competitionHeaders });
    return competitionFailure(error);
  }
}
