import { z } from "zod";
import { requireOperationalUser } from "@/server/auth/session";
import { createReportSignatureStorage, readReportSignature } from "@/features/match-reports/server/signatures";
import { reportHttpError } from "@/features/match-reports/server/http";
import { ReportError } from "@/features/match-reports/contract";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ matchId: string; fileId: string }> }) {
  try { const actor = await requireOperationalUser(); const { matchId, fileId } = await params;
    if (!z.uuid().safeParse(fileId).success) throw new ReportError("INVALID_PAYLOAD", 400);
    const bytes = await readReportSignature(actor.id, matchId, fileId, createReportSignatureStorage());
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return reportHttpError(error); }
}
