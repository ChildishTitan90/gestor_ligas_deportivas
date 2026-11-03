import { advanceSeason } from "@/features/competitions/server/season-start";
import { CompetitionError } from "@/features/competitions/server/configuration";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await params;
    if (action !== "close-registrations" && action !== "start") throw new CompetitionError("INVALID_CONFIGURATION");
    return Response.json(await advanceSeason(id, action, await readCompetitionBody(request)), { headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
