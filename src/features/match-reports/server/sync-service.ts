import "server-only";
import { getPrisma } from "@/server/db/prisma";
import { evaluateAuthorizedMatchInTransaction } from "@/features/matches/server/eligibility";
import { assertCaptureState, reportAccess } from "./access";
import { buildPresentation } from "./queries";
import type { ReportDraft } from "../contract";
import { ReportError } from "../contract";
import { mutateReport, readReportOperation } from "./service";

export { mutateReport as syncReport, readReportOperation as readSyncReceipt };

export async function prepareOwnReport(actorId: string, matchId: string) {
  return getPrisma().$transaction(async tx => {
    const match = await reportAccess(tx, actorId, matchId);
    // reportAccess restricts REFEREE to their effective assignment and preserves
    // the existing DATA_ENTRY league/club authorization.
    assertCaptureState(match);
    const report = await tx.match_reports.findUnique({ where: { match_id: matchId } });
    if (report && report.status !== "DRAFT") throw new ReportError("REPORT_LOCKED");
    const evaluation = await evaluateAuthorizedMatchInTransaction(tx, match);
    const draft = (report?.draft_data as { draft?: ReportDraft } | undefined)?.draft ??
      { lineups: [], captains: {}, events: [], score: { home: null, away: null }, remarks: "", incidents: "", signatures: {} };
    const data = await buildPresentation(tx, match, report ?? { id: matchId, version: 0, status: "DRAFT", confirmed_at: null }, draft, evaluation);
    // Photos and identity documents are deliberately outside the offline snapshot.
    data.players = data.players.map(player => ({ ...player, photoUrl: null }));
    return { actorId, preparedAt: new Date().toISOString(), data };
  }, { timeout: 30000 });
}
