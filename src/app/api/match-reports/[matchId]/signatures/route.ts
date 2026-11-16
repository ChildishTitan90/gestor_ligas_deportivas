import { requireOperationalUser } from "@/server/auth/session";
import { createReportSignatureStorage, uploadReportSignature } from "@/features/match-reports/server/signatures";
import { readReportBody, reportHttpError } from "@/features/match-reports/server/http";
import { ReportError } from "@/features/match-reports/contract";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try { const actor = await requireOperationalUser(); const { matchId } = await params; const body = await readReportBody(request, actor.id, 1800000);
    if (!body || typeof body !== "object" || !("matchId" in body) || body.matchId !== matchId) throw new ReportError("INVALID_PAYLOAD", 400);
    return Response.json(await uploadReportSignature(actor.id, body, createReportSignatureStorage()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reportHttpError(error); }
}
