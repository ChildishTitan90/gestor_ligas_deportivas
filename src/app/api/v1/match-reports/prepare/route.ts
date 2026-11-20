import { requireOperationalUser } from "@/server/auth/session";
import { prepareOwnReport } from "@/features/match-reports/server/sync-service";
import { readReportBody, reportHttpError } from "@/features/match-reports/server/http";
import { ReportError } from "@/features/match-reports/contract";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const actor = await requireOperationalUser();
    const input = z.strictObject({ matchId: z.uuid() }).safeParse(await readReportBody(request, actor.id));
    if (!input.success) throw new ReportError("INVALID_PAYLOAD", 400);
    return Response.json(await prepareOwnReport(actor.id, input.data.matchId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reportHttpError(error); }
}
