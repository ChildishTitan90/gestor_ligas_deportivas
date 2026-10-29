import { createCategoryCatalog, listCategoryCatalog } from "@/features/competitions/server/categories";
import { CompetitionError } from "@/features/competitions/server/configuration";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.size !== 1 || !params.has("leagueId")) throw new CompetitionError("INVALID_CONFIGURATION");
    return Response.json(await listCategoryCatalog(params.get("leagueId")!), { headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
export async function POST(request: Request) {
  try { return Response.json(await createCategoryCatalog(await readCompetitionBody(request)), { status: 201, headers: competitionHeaders }); }
  catch (error) { return competitionFailure(error); }
}
