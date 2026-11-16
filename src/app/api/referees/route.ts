import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { readCompetitionBody, competitionHeaders } from "@/features/competitions/server/http";
import { CompetitionError } from "@/features/competitions/server/configuration";
import { assessAssignment, authorizeRefereeing, mutateRefereeing, recoverRefereeOperation, RefereeError } from "@/features/referees/server/service";
import { getRefereeWorkspaceForActor } from "@/features/referees/server/queries";
import { z } from "zod";
const response = (value: unknown) => Response.json(value, { headers: competitionHeaders });
function failure(error: unknown) {
  if (error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof RefereeError || error instanceof CompetitionError) return Response.json({ code: error.code }, { status: error.status, headers: competitionHeaders });
  console.error("[refereeing] REQUEST_FAILED");
  return Response.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503, headers: competitionHeaders });
}
export async function POST(request: Request) {
  try { const actor = await requireOperationalUser(); return response(await mutateRefereeing(actor.id, await readCompetitionBody(request))); }
  catch (error) { return failure(error); }
}
export async function GET(request: Request) {
  try {
    const actor = await requireOperationalUser(); const q = new URL(request.url).searchParams;
    if (q.get("operationKey")) return response({ receipt: await recoverRefereeOperation(actor.id, q.get("operationKey")!) });
    if (q.get("matchId")) {
      const parsed = z.object({ leagueId: z.uuid(), seasonId: z.uuid(), matchId: z.uuid(), refereeId: z.uuid(), assignmentId: z.uuid().optional() }).safeParse(Object.fromEntries(q));
      if (!parsed.success) throw new RefereeError("INVALID_PAYLOAD", 400);
      const { leagueId, seasonId, matchId, refereeId, assignmentId } = parsed.data;
      return response(await getPrisma().$transaction(async tx => {
        await authorizeRefereeing(tx, actor.id, "READ", leagueId, seasonId, undefined, matchId);
        // A UUID de otra temporada no concede lectura de datos del árbitro.
        if (!await tx.club_season_referees.findUnique({ where: { referee_id_season_id: { referee_id: refereeId, season_id: seasonId } } })) throw new AuthorizationError();
        if (assignmentId && !await tx.referee_assignments.findFirst({ where: { id: assignmentId, match_id: matchId, referee_id: refereeId }, select: { id: true } })) throw new AuthorizationError();
        return assessAssignment(tx, matchId, refereeId, assignmentId);
      }));
    }
    return response(await getRefereeWorkspaceForActor(actor.id, q.get("league") ?? "", q.get("season") ?? ""));
  } catch (error) { return failure(error); }
}
