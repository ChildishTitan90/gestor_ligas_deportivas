import { z } from "zod";
import { requireOperationalUser } from "@/server/auth/session";
import { getReportPage, mutateReport, readReportOperation } from "@/features/match-reports/server/service";
import { readReportBody, reportHttpError } from "@/features/match-reports/server/http";
import { ReportError } from "@/features/match-reports/contract";
import { AuthorizationError } from "@/server/auth/authorization";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try { const actor = await requireOperationalUser(); const { matchId } = await params; const operationId = new URL(request.url).searchParams.get("operationId");
    if (request.headers.has("X-Expected-Actor-Id") && request.headers.get("X-Expected-Actor-Id") !== actor.id) throw new AuthorizationError();
    if (operationId && !z.uuid().safeParse(operationId).success) throw new ReportError("INVALID_PAYLOAD", 400);
    return Response.json(operationId ? await readReportOperation(actor.id, matchId, operationId) : await getReportPage(actor.id, matchId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reportHttpError(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try { const actor = await requireOperationalUser(); const { matchId } = await params; const body = await readReportBody(request, actor.id);
    if (!body || typeof body !== "object" || !("matchId" in body) || body.matchId !== matchId) throw new ReportError("INVALID_PAYLOAD", 400);
    return Response.json(await mutateReport(actor.id, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reportHttpError(error); }
}
