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
};
type Account = { actorId: string; expiresAt: number };

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
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = callback;
  window.addEventListener(channelName, callback);
  return () => { channel.close(); window.removeEventListener(channelName, callback); };
}
export function activeOfflineAccount() {
  return transact<Account | undefined>("readonly", (tx, result) => {
    const request = tx.objectStore("account").get("active");
    request.onsuccess = () => result(request.result);
  });
}
export async function authorizeLocalAccount(actorId: string) {
  await transact<void>("readwrite", tx => {
    const accounts = tx.objectStore("account");
    const request = accounts.get("active");
    request.onsuccess = () => {
      if (request.result?.actorId !== actorId) tx.objectStore("reports").clear();
      accounts.put({ actorId, expiresAt: Date.now() + OFFLINE_TTL }, "active");
    };
  });
  announceReportChange();
}
export async function clearLocalReports() {
  if (!("indexedDB" in window)) return;
  await transact<void>("readwrite", tx => {
    tx.objectStore("reports").clear();
    tx.objectStore("account").clear();
  });
  announceReportChange();
}
export async function observeLocalAccount(actorId: string) {
  const account = await activeOfflineAccount();
  if (account && account.actorId !== actorId) await clearLocalReports();
}
export function readLocalReports() {
  return transact<LocalReport[]>("readonly", (tx, result) => {
    const account = tx.objectStore("account").get("active");
    account.onsuccess = () => {
      const request = tx.objectStore("reports").getAll();
      request.onsuccess = () => result((request.result as LocalReport[]).filter(row =>
        row.actorId === account.result?.actorId && row.expiresAt > Date.now() && account.result.expiresAt > Date.now()));
    };
  });
}
export async function readLocalReport(actorId: string, matchId: string) {
  return (await readLocalReports()).find(row => row.actorId === actorId && row.matchId === matchId);
}
/** Call only after reauthentication and authorization of this match. */
export function readExpiredLocalReport(actorId: string, matchId: string) {
  return transact<LocalReport | undefined>("readonly", (tx, result) => {
    const request = tx.objectStore("reports").get([actorId, matchId]);
    request.onsuccess = () => result(request.result);
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
        const next = prior ? { ...record, pending: prior.pending, acknowledgedRevision: prior.acknowledgedRevision, lastReceipt: prior.lastReceipt,
          prepared: prior.prepared || record.prepared, serverMatchStatus: prior.serverMatchStatus, expiresAt: prior.expiresAt,
          data: { ...record.data, match: { ...record.data.match, version: prior.data.match.version }, report: { ...record.data.report, version: prior.data.report.version } } } : record;
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
export async function hasPendingLocalReports() {
  // Expired copies still contain pending work and must be included in the
  // explicit logout warning before deleting private data.
  return transact<boolean>("readonly", (tx, result) => {
    const account = tx.objectStore("account").get("active");
    account.onsuccess = () => {
      const reports = tx.objectStore("reports").getAll();
      reports.onsuccess = () => result((reports.result as LocalReport[]).some(row =>
        row.actorId === account.result?.actorId && (row.revision > row.acknowledgedRevision || row.pending.length > 0)));
    };
  });
}
