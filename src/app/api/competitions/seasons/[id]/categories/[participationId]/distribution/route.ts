import { assignCompetitionGroup, listPendingDistribution } from "@/features/competitions/server/distribution";
import { CompetitionError } from "@/features/competitions/server/configuration";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; participationId: string }> }) {
  try { const { id, participationId } = await params;
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== "after") || query.getAll("after").length > 1) throw new CompetitionError("INVALID_CONFIGURATION");
    return Response.json(await listPendingDistribution(id, participationId, query.get("after") ?? undefined), { headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string; participationId: string }> }) {
  try { const { id, participationId } = await params;
    return Response.json(await assignCompetitionGroup(id, participationId, await readCompetitionBody(request)), { headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
