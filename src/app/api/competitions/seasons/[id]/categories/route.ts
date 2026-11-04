import { associateSeasonCategory, listSeasonCategories } from "@/features/competitions/server/categories";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try { return Response.json(await listSeasonCategories((await params).id), { headers: competitionHeaders }); }
  catch (error) { return competitionFailure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try { return Response.json(await associateSeasonCategory((await params).id, await readCompetitionBody(request)), { status: 201, headers: competitionHeaders }); }
  catch (error) { return competitionFailure(error); }
}
