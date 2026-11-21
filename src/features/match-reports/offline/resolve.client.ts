import { createReportClient } from "../report-client";
import type { ReportDemoData } from "../types";
import { downloadOwnReport, newLocalReport } from "./prepare.client";
import { readLocalReport, updateLocalReport, type ArchivedReport, type LocalReport } from "./store.client";

export type ResolutionChoice = "server" | "review";
export async function resolveReportConflict(working: LocalReport, expected: LocalReport, reference: ReportDemoData, choice: ResolutionChoice) {
  const { actorId, matchId } = working;
  return navigator.locks.request(`report-sync:${actorId}:${matchId}`, { ifAvailable: true }, async lock => {
    if (!lock) throw Error("RESOLUTION_BUSY");
    const latest = await readLocalReport(actorId, matchId);
    if (!latest || JSON.stringify(latest) !== JSON.stringify(expected)) throw Error("LOCAL_REVISION_CONFLICT");
    // Resolve uncertain outcomes before replacing the active queue. This path
    // only reads receipts and an authorized snapshot, never resends old intents.
    const client = createReportClient(actorId, latest.data);
    for (const item of latest.pending) await client.query(item.operation.id);
    const fresh = await downloadOwnReport(actorId, matchId);
    if (fresh.match.version !== reference.match.version || fresh.report.version !== reference.report.version)
      throw Error("RESOLUTION_REFERENCE_CHANGED");
    const next = newLocalReport(actorId, fresh);
    if (choice === "review") {
      next.data.report = {
        ...fresh.report, events: structuredClone(working.data.report.events),
        score: structuredClone(working.data.report.score), remarks: working.data.report.remarks,
        incidents: working.data.report.incidents, signatures: {},
      };
      next.revision = 1;
      next.reviewRequired = true;
    }
    const archivedAt = new Date().toISOString();
    const archive = (record: LocalReport): ArchivedReport => ({
      draftId: record.draftId, editId: record.editId, revision: record.revision,
      acknowledgedRevision: record.acknowledgedRevision, data: record.data, pending: record.pending,
      lastReceipt: record.lastReceipt, archivedAt, choice,
    });
    const copies = JSON.stringify(working) === JSON.stringify(latest) ? [working] : [latest, working];
    return updateLocalReport(actorId, matchId, current => {
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw Error("LOCAL_REVISION_CONFLICT");
      return { ...next, prepared: current.prepared, expiresAt: current.expiresAt,
        archives: [...(current.archives ?? []), ...copies.map(archive)] };
    });
  });
}
