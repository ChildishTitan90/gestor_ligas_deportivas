import { ZodError } from "zod";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
import { previewScheduleAdjustment } from "@/features/scheduling/server/adjustment";

export async function POST(request: Request) {
  try {
    const result = await previewScheduleAdjustment(await readCompetitionBody(request));
    return Response.json(result, { headers: competitionHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ code: "INVALID_PAYLOAD" }, { status: 400, headers: competitionHeaders });
    }
    return competitionFailure(error);
  }
}
