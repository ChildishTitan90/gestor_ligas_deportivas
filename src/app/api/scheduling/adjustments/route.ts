import { ZodError } from "zod";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
import { saveScheduleAdjustment } from "@/features/scheduling/server/adjustment";
import { editStoredProposal } from "@/features/scheduling/server/stored-proposal-edit";

export async function POST(request: Request) {
  try {
    const body = await readCompetitionBody(request);
    const result = body && typeof body === "object" && "encounterIndex" in body
      ? await editStoredProposal(body) : await saveScheduleAdjustment(body);
    return Response.json(result, {
      status: result.code === "ADJUSTMENT_SAVED" ? 200 : 409,
      headers: competitionHeaders,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ code: "INVALID_PAYLOAD" }, { status: 400, headers: competitionHeaders });
    }
    return competitionFailure(error);
  }
}
