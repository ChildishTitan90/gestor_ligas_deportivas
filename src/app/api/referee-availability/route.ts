import { requireOperationalUser, AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { readCompetitionBody, competitionHeaders } from "@/features/competitions/server/http";
import { CompetitionError } from "@/features/competitions/server/configuration";
import { RefereeError } from "@/features/referees/server/service";
import { getOwnAvailabilityWorkspaceForActor, mutateOwnAvailability, recoverOwnAvailability } from "@/features/referees/server/own-availability";
function failure(error: unknown) {
  if (error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof RefereeError || error instanceof CompetitionError)
    return Response.json({ code: error.code }, { status: error.status, headers: competitionHeaders });
  console.error("[own-referee-availability] REQUEST_FAILED");
  return Response.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers: competitionHeaders });
}
export async function POST(request: Request) {
  try { const actor = await requireOperationalUser(); return Response.json(await mutateOwnAvailability(actor.id, await readCompetitionBody(request)), { headers: competitionHeaders }); }
  catch (error) { return failure(error); }
}
export async function GET(request: Request) {
  try {
    const actor = await requireOperationalUser(), q = new URL(request.url).searchParams;
    return Response.json(q.has("operationKey") ? { receipt: await recoverOwnAvailability(actor.id, q.get("operationKey") ?? "") }
      : await getOwnAvailabilityWorkspaceForActor(actor.id, q.get("league") ?? "", q.get("season") ?? ""), { headers: competitionHeaders });
  } catch (error) { return failure(error); }
}
