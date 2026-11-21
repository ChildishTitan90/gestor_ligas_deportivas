import { ZodError } from "zod";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
import { changeProposalReview } from "@/features/scheduling/server/adjustment";

export async function POST(request: Request) {
  try {
    const result = await changeProposalReview(await readCompetitionBody(request));
    return Response.json(result, {
      status: result.code === "PROPOSAL_UPDATED" ? 200 : 409,
      headers: competitionHeaders,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ code: "INVALID_PAYLOAD" }, { status: 400, headers: competitionHeaders });
    }
    return competitionFailure(error);
  }
}
