import { createReportClient, prepareReportAttempt, ReportClientError, type ReportOperation } from "../report-client";
import { advanceMatchClock } from "../match-clock";
import type { ReportReceipt } from "../contract";
import type { LocalReport, PendingReport } from "./store.client";
import { readLocalReport, updateLocalReport } from "./store.client";

export async function enqueueReport(actorId: string, matchId: string, kind: ReportOperation["kind"], clockAction?: ReportOperation["clockAction"], expectedEditId?: string) {
  return updateLocalReport(actorId, matchId, record => {
    if (expectedEditId && record.editId !== expectedEditId) throw Error("LOCAL_REVISION_CONFLICT");
    if (kind === "confirm" && !record.data.confirmation?.available) throw new ReportClientError("CONFIRMATION_DEPENDENCIES_PENDING", 409);
    if (record.pending.some(item => item.error)) throw Error("PENDING_REVIEW_REQUIRED");
    const operation: ReportOperation = {
      id: crypto.randomUUID(), kind, ...(clockAction ? { clockAction, occurredAt: new Date().toISOString() } : {}),
      expectedReportVersion: record.data.report.version + record.pending.length,
      expectedMatchVersion: record.data.match.version + (record.serverMatchStatus === "CONFIRMED" && record.pending.some(item => item.operation.clockAction?.type === "start") ? 1 : 0),
      snapshot: structuredClone(record.data.report),
    };
    const data = structuredClone(record.data);
    if (kind === "clock") {
      data.report.clock = advanceMatchClock(data.report.clock ?? null, clockAction!, operation.occurredAt!);
      if (clockAction?.type === "start") data.match.status = { code: "IN_PROGRESS", label: "En curso", captureAllowed: true };
    }
    if (kind === "lock-lineups") data.report.lineupsLock = { operationId: operation.id, lockedAt: new Date().toISOString() };
    const revision = record.revision + (kind === "clock" || kind === "lock-lineups" ? 1 : 0);
    const pending: PendingReport = { operation, draftId: record.draftId, revision, attempt: prepareReportAttempt(data, operation) };
    return { ...record, data, revision, editId: revision === record.revision ? record.editId : crypto.randomUUID(), pending: [...record.pending, pending] };
  });
}
function validateReceipt(item: PendingReport, receipt: ReportReceipt) {
  if (receipt.formatVersion !== 1 || receipt.operationId !== item.operation.id ||
      receipt.matchId !== item.operation.snapshot.matchId || receipt.reportVersion !== item.operation.expectedReportVersion + 1 ||
      receipt.matchVersion < item.operation.expectedMatchVersion ||
      receipt.status !== (item.operation.kind === "confirm" ? "CONFIRMED" : "DRAFT")) throw Error("INVALID_RECEIPT");
}
async function acknowledge(actorId: string, matchId: string, item: PendingReport, receipt: ReportReceipt) {
  validateReceipt(item, receipt);
  return updateLocalReport(actorId, matchId, record => {
    const sent = record.pending.find(pending => pending.operation.id === receipt.operationId);
    if (!sent) return record;
    const report = { ...record.data.report, id: receipt.reportId, version: receipt.reportVersion, status: receipt.status };
    report.signatures = Object.fromEntries(Object.entries(report.signatures).map(([teamId, signature]) => {
      const uploaded = sent.attempt.command.draft.signatures[teamId];
      return [teamId, uploaded && signature && signature.image === item.operation.snapshot.signatures[teamId]?.image
        ? { ...signature, fileId: uploaded } : signature];
    }));
    if (!report.lineupsLock && receipt.lineupsLock) report.lineupsLock = receipt.lineupsLock;
    if (receipt.clock) {
      report.clock = receipt.clock;
      // Replay only later durable clock intents over the authoritative receipt.
      const later = record.pending.slice(record.pending.findIndex(pending => pending.operation.id === receipt.operationId) + 1);
      for (const pending of later) {
        if (pending.operation.clockAction && pending.operation.occurredAt)
          report.clock = advanceMatchClock(report.clock, pending.operation.clockAction, pending.operation.occurredAt);
      }
    }
    // Never replace report content with an older sent snapshot.
    return {
      ...record, data: { ...record.data, report, match: { ...record.data.match, version: receipt.matchVersion } },
      pending: record.pending.filter(pending => pending.operation.id !== receipt.operationId),
      serverMatchStatus: item.operation.clockAction?.type === "start" ? "IN_PROGRESS" : record.serverMatchStatus,
      acknowledgedRevision: Math.max(record.acknowledgedRevision, item.revision),
      lastReceipt: { draftId: item.draftId, revision: item.revision, receipt },
    };
  });
}
export async function synchronizeReport(actorId: string, matchId: string, notify: (record: LocalReport) => void, liveClockOperations?: Set<string>) {
  return navigator.locks.request(`report-sync:${actorId}:${matchId}`, { ifAvailable: true }, async lock => {
    if (!lock) return;
    for (;;) {
      const record = await readLocalReport(actorId, matchId);
      if (!record) throw Error("LOCAL_ACCOUNT_LOCKED");
      for (const id of liveClockOperations ?? []) if (!record.pending.some(item => item.operation.id === id)) liveClockOperations?.delete(id);
      const item = record.pending[0];
      if (!item || item.error || !navigator.onLine) return;
      const client = createReportClient(actorId, record.data, {
        load: async () => structuredClone(item.attempt),
        save: async (id, attempt) => {
          await updateLocalReport(actorId, matchId, current => ({
            ...current, pending: current.pending.map(pending => pending.operation.id === id ? { ...pending, attempt: structuredClone(attempt) } : pending),
          }));
        },
      });
      try {
        const liveClock = liveClockOperations?.has(item.operation.id) === true && item.operation.kind === "clock";
        liveClockOperations?.delete(item.operation.id);
        const found: Awaited<ReturnType<typeof client.query>> = liveClock ? { status: "UNKNOWN" } : await client.query(item.operation.id);
        const receipt = found.status === "APPLIED" && found.receipt ? found.receipt : await client.send(item.operation, liveClock);
        notify(await acknowledge(actorId, matchId, item, receipt));
      } catch (error) {
        if (error instanceof ReportClientError && error.code === "CONFIRMATION_DEPENDENCIES_PENDING") {
          notify(await updateLocalReport(actorId, matchId, current => ({
            ...current, data: { ...current.data, confirmation: { available: false, message: "El cierre oficial sigue pendiente. Puedes sincronizar el borrador." } },
            pending: current.pending.filter(pending => pending.operation.id !== item.operation.id),
          })));
          throw error;
        }
        if (error instanceof ReportClientError && error.status < 500 && error.status !== 401) {
          notify(await updateLocalReport(actorId, matchId, current => ({
            ...current, pending: current.pending.map(pending => pending.operation.id === item.operation.id ? { ...pending, error: error.code } : pending),
          })));
        }
        throw error;
      }
    }
  });
}
