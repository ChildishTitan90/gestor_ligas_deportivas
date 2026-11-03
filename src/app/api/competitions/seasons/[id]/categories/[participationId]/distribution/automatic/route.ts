import { distributeCompetitionGroups } from "@/features/competitions/server/distribution";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string; participationId: string }> }) {
  try {
    const { id, participationId } = await params;
    return Response.json(await distributeCompetitionGroups(id, participationId, await readCompetitionBody(request)), { headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
