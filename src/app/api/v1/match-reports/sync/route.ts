import { requireOperationalUser } from "@/server/auth/session";
import { syncReport, readSyncReceipt } from "@/features/match-reports/server/sync-service";
import { readReportBody, reportHttpError } from "@/features/match-reports/server/http";
import { AuthorizationError } from "@/server/auth/authorization";
import { ReportError } from "@/features/match-reports/contract";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const actor = await requireOperationalUser();
    return Response.json(await syncReport(actor.id, await readReportBody(request, actor.id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reportHttpError(error); }
}
export async function GET(request: Request) {
  try {
    const actor = await requireOperationalUser();
    const query = new URL(request.url).searchParams;
    if (request.headers.get("X-Expected-Actor-Id") !== actor.id) throw new AuthorizationError();
    const input = z.object({ matchId: z.uuid(), operationId: z.uuid() }).safeParse(Object.fromEntries(query));
    if (!input.success) throw new ReportError("INVALID_PAYLOAD", 400);
    return Response.json(await readSyncReceipt(actor.id, input.data.matchId, input.data.operationId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reportHttpError(error); }
}
