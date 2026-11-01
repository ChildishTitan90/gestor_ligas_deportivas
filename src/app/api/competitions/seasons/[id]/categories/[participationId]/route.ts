import { maintainSeasonCategory } from "@/features/competitions/server/maintenance";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; participationId: string }> };
async function mutate(request: Request, { params }: Context, operation: "UPDATE" | "DELETE") {
  try {
    const { id, participationId } = await params;
    return Response.json(await maintainSeasonCategory(id, participationId, operation, await readCompetitionBody(request)), { headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
export async function PATCH(request: Request, context: Context) { return mutate(request, context, "UPDATE"); }
export async function DELETE(request: Request, context: Context) { return mutate(request, context, "DELETE"); }
