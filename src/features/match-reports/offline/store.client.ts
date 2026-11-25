import type { ReportAttempt, ReportOperation } from "../report-client";
import type { ReportDemoData } from "../types";
import type { ReportReceipt } from "../contract";

export const OFFLINE_TTL = 7 * 24 * 60 * 60 * 1000;
export const OFFLINE_DATABASE = "league-match-reports-v1";
const channelName = "league-match-reports";
export type PendingReport = {
  operation: ReportOperation; attempt: ReportAttempt; draftId: string; revision: number;
  error?: string;
};
export type LocalReport = {
  actorId: string; matchId: string; draftId: string; editId: string; revision: number; acknowledgedRevision: number;
  data: ReportDemoData; expiresAt: number; prepared: boolean; updatedAt: string;
  serverMatchStatus: string;
  pending: PendingReport[];
  lastReceipt?: { draftId: string; revision: number; receipt: ReportReceipt };
  noShowConfirmation?: {
    operationId: string; matchId: string; reportId: string; expectedMatchVersion: number; expectedReportVersion: number;
    receipt?: { matchId: string; reportId: string; matchVersion: number; reportVersion: number; replayed: boolean };
  };
  archives?: ArchivedReport[];
  reviewRequired?: boolean;
};
export type ArchivedReport = Pick<LocalReport, "draftId" | "editId" | "revision" | "acknowledgedRevision" | "data" | "pending" | "lastReceipt"> & {
  archivedAt: string; choice: "server" | "review";
};


function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("reports", { keyPath: ["actorId", "matchId"] });
      request.result.createObjectStore("account");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("LOCAL_DATABASE_BLOCKED"));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transact<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction, result: (value: T) => void, fail: (reason: string | Error) => void) => void): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(["reports", "account"], mode);
      let value: T;
      let failure: Error | undefined;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure ?? tx.error ?? Error("LOCAL_WRITE_FAILED"));
      action(tx, result => { value = result; }, reason => { failure = typeof reason === "string" ? Error(reason) : reason; tx.abort(); });
    });
  } finally { db.close(); }
}
export function announceReportChange() {
  window.dispatchEvent(new Event(channelName));
  if (!("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel(channelName);
  channel.postMessage("changed");
  channel.close();
}
export function subscribeReports(callback: () => void) {
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
  if (channel) channel.onmessage = callback;
  window.addEventListener(channelName, callback);
  return () => { channel?.close(); window.removeEventListener(channelName, callback); };
}
export function activeOfflineAccount() {
  return transact<{ actorId: string; expiresAt: number } | undefined>("readonly", (tx, result) => {
    const request = tx.objectStore("account").get("active");
    request.onsuccess = () => result(request.result);
  });
}
// Lock the old partition during sign-in. Only a server-authenticated identity
// reopens its own unexpired records. Neither transition edits the drafts.
export async function observeLocalAccount(actorId: string | null) {
  const changed = await transact<boolean>("readwrite", (tx, result) => {
    const accounts = tx.objectStore("account");
    const request = accounts.get("active");
    request.onsuccess = () => {
      if ((request.result?.actorId ?? null) === actorId) return result(false);
      if (actorId) accounts.put({ actorId, expiresAt: Date.now() + OFFLINE_TTL }, "active");
      else accounts.delete("active");
      result(true);
    };
  });
  if (changed) announceReportChange();
}
const accountRange = (actorId: string) => IDBKeyRange.bound([actorId], [actorId, []]);
export async function clearLocalReports(actorId: string, discardPending: boolean) {
  const cleared = await transact<boolean>("readwrite", (tx, result) => {
    const accounts = tx.objectStore("account");
    const active = accounts.get("active");
    active.onsuccess = () => {
      if (active.result?.actorId !== actorId) return result(true);
      const store = tx.objectStore("reports"), range = accountRange(actorId);
      const cursor = store.openCursor(range);
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (entry && !discardPending) {
          const row = entry.value as LocalReport;
          if (row.pending.length || row.revision > row.acknowledgedRevision || row.archives?.length) return result(false);
          entry.continue();
          return;
        }
        store.delete(range);
        accounts.delete("active");
        result(true);
      };
    };
  });
  if (cleared) announceReportChange();
  return cleared;
}
export function readLocalReports(actorId?: string, matchId?: string) {
  return transact<LocalReport[]>("readonly", (tx, result) => {
    const account = tx.objectStore("account").get("active");
    account.onsuccess = () => {
      if (!account.result || account.result.expiresAt <= Date.now() || actorId && account.result.actorId !== actorId) return result([]);
      const request = tx.objectStore("reports").getAll(matchId ? [account.result.actorId, matchId] : accountRange(account.result.actorId));
      request.onsuccess = () => result((request.result as LocalReport[]).filter(row => row.expiresAt > Date.now()));
    };
  });
}
export async function readLocalReport(actorId: string, matchId: string) {
  return (await readLocalReports(actorId, matchId))[0];
}
/** Call only after reauthentication and authorization of this match. */
export function renewLocalReportAccess(actorId: string, matchId: string) {
  return transact<LocalReport | undefined>("readwrite", (tx, result, fail) => {
    const accounts = tx.objectStore("account");
    const active = accounts.get("active");
    active.onsuccess = () => {
      if (active.result?.actorId !== actorId) return fail("LOCAL_ACCOUNT_LOCKED");
      accounts.put({ actorId, expiresAt: Date.now() + OFFLINE_TTL }, "active");
      const request = tx.objectStore("reports").get([actorId, matchId]);
      request.onsuccess = () => result(request.result);
    };
  });
}
/** Compare-and-swap in the same IDB transaction. Another tab never wins silently. */
export async function writeLocalReport(record: LocalReport, expectedRevision: number | null) {
  await transact<void>("readwrite", (tx, _result, fail) => {
    const accounts = tx.objectStore("account").get("active");
    accounts.onsuccess = () => {
      if (accounts.result?.actorId !== record.actorId || accounts.result.expiresAt <= Date.now()) return fail("LOCAL_ACCOUNT_LOCKED");
      const store = tx.objectStore("reports");
      const request = store.get([record.actorId, record.matchId]);
      request.onsuccess = () => {
        const prior = request.result as LocalReport | undefined;
        if ((prior?.revision ?? null) !== expectedRevision || prior && prior.draftId !== record.draftId) return fail("LOCAL_REVISION_CONFLICT");
        // Receipts can arrive while a later edit is being written.
        const next = prior ? { ...record, pending: prior.pending, acknowledgedRevision: prior.acknowledgedRevision, lastReceipt: prior.lastReceipt, noShowConfirmation: prior.noShowConfirmation,
          prepared: prior.prepared || record.prepared, serverMatchStatus: prior.serverMatchStatus, expiresAt: prior.expiresAt,
          data: { ...record.data, match: { ...record.data.match, version: prior.data.match.version }, report: { ...record.data.report, version: prior.data.report.version, clock: prior.data.report.clock, lineupsLock: prior.data.report.lineupsLock } } } : record;
        store.put(next);
      };
    };
  });
  announceReportChange();
}
export async function updateLocalReport(actorId: string, matchId: string, update: (record: LocalReport) => LocalReport) {
  const record = await transact<LocalReport>("readwrite", (tx, result, fail) => {
    const account = tx.objectStore("account").get("active");
    account.onsuccess = () => {
      if (account.result?.actorId !== actorId || account.result.expiresAt <= Date.now()) return fail("LOCAL_ACCOUNT_LOCKED");
      const store = tx.objectStore("reports");
      const request = store.get([actorId, matchId]);
      request.onsuccess = () => {
        if (!request.result) return fail("LOCAL_COPY_EXPIRED");
        try {
          const next = update(request.result);
          store.put(next);
          result(next);
        } catch (error) { fail(error instanceof Error ? error : Error("LOCAL_WRITE_FAILED")); }
      };
    };
  });
  announceReportChange();
  return record;
}
