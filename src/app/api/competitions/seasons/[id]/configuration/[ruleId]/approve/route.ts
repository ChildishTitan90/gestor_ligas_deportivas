import { approveCompetitionRule } from "@/features/competitions/server/rule-approval";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string; ruleId: string }> }) {
  try {
    const { id, ruleId } = await params;
    return Response.json(await approveCompetitionRule(id, ruleId, await readCompetitionBody(request)), { headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
