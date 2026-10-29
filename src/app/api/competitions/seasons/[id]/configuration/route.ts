import { createCompetitionRuleDraft, getCompetitionConfiguration } from "@/features/competitions/server/configuration";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try { return Response.json(await getCompetitionConfiguration((await params).id), { headers: competitionHeaders }); }
  catch (error) { return competitionFailure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const body = await readCompetitionBody(request);
    return Response.json(await createCompetitionRuleDraft((await params).id, body), { status: 201, headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
