import { listCompetitionGroups, mutateCompetitionGroup } from "@/features/competitions/server/groups";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; participationId: string }> };
export async function GET(_request: Request, { params }: Context) {
  try { const { id, participationId } = await params;
    return Response.json(await listCompetitionGroups(id, participationId), { headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
async function mutate(request: Request, context: Context, operation: "CREATE" | "RENAME" | "DELETE") {
  try { const { id, participationId } = await context.params;
    const result = await mutateCompetitionGroup(id, participationId, operation, await readCompetitionBody(request));
    return Response.json(result, { status: operation === "CREATE" ? 201 : 200, headers: competitionHeaders });
  } catch (error) { return competitionFailure(error); }
}
export async function POST(request: Request, context: Context) { return mutate(request, context, "CREATE"); }
export async function PATCH(request: Request, context: Context) { return mutate(request, context, "RENAME"); }
export async function DELETE(request: Request, context: Context) { return mutate(request, context, "DELETE"); }
