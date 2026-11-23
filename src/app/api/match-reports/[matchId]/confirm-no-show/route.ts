import { Prisma } from "@prisma/client";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { isTransactionConflict } from "@/server/db/transaction-conflict";
import { confirmNoShowInTransaction } from "@/features/matches/server/confirm-no-show";
import { openIncidentCases } from "@/features/match-reports/server/incident-cases";
import { readReportBody, reportHttpError } from "@/features/match-reports/server/http";
import { ReportError } from "@/features/match-reports/contract";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const actor = await requireOperationalUser();
    const { matchId } = await params;
    const body = await readReportBody(request, actor.id);
    if (!body || typeof body !== "object" || !("matchId" in body) || body.matchId !== matchId) throw new ReportError("INVALID_PAYLOAD", 400);
    for (let attempt = 0; ; attempt++) {
      try {
        const receipt = await getPrisma().$transaction(tx => confirmNoShowInTransaction(tx, actor.id, body, { openIncidentCases }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
        return Response.json(receipt, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        if (error instanceof Error && error.message === "RULES_NOT_APPROVED") throw new ReportError("STANDINGS_RULES_INCOMPLETE", 409);
        if (!isTransactionConflict(error)) throw error;
        if (attempt >= 4) throw new ReportError("PARTICIPATION_RETRY_REQUIRED", 409);
      }
    }
  } catch (error) { return reportHttpError(error); }
}
