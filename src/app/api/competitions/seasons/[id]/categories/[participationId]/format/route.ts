import { configureGeneralTable } from "@/features/competitions/server/formats";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; participationId: string }> }) {
  try { const { id, participationId } = await params;
    return Response.json(await configureGeneralTable(id, participationId, await readCompetitionBody(request)), { headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
