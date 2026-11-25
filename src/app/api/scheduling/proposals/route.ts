import { z } from "zod";
import { requireOperationalUser } from "@/server/auth/session";
import { competitionFailure, competitionHeaders } from "@/features/competitions/server/http";
import { listSavedScheduleProposals } from "@/features/scheduling/server/saved-proposals";

const querySchema = z.object({ seasonId: z.uuid(), groupId: z.uuid() }).strict();

export async function GET(request: Request) {
  try {
    const actor = await requireOperationalUser();
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const proposals = await listSavedScheduleProposals(actor.id, query.seasonId, query.groupId);
    return Response.json({ proposals }, { headers: competitionHeaders });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ code: "INVALID_INPUT" }, { status: 400, headers: competitionHeaders });
    return competitionFailure(error);
  }
}
