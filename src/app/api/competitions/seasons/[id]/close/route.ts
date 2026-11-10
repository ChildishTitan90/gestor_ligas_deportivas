import { closeSeason } from "@/features/competitions/server/close-season";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await closeSeason((await params).id, await readCompetitionBody(request)), { headers: competitionHeaders }); }
  catch (error) { return competitionFailure(error); }
}
