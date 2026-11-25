import type { ReportDemoData } from "../types";
import { OFFLINE_TTL, type LocalReport, renewLocalReportAccess, writeLocalReport, updateLocalReport } from "./store.client";
import { prepareReportResources } from "./resources.client";

export async function downloadOwnReport(actorId: string, matchId: string): Promise<ReportDemoData> {
  const response = await fetch("/api/v1/match-reports/prepare", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Expected-Actor-Id": actorId },
    body: JSON.stringify({ matchId }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(response.status === 401 ? "SESSION_EXPIRED" : "PREPARATION_DENIED");
  const value = await response.json();
  if (value.actorId !== actorId || value.data?.match.id !== matchId) throw Error("PREPARATION_DENIED");
  const data = value.data as ReportDemoData;
  for (const signature of Object.values(data.report.signatures)) {
    if (!signature) continue;
    signature.fileId = signature.image.split("/").at(-1);
    const image = await fetch(signature.image, { cache: "no-store", headers: { "X-Expected-Actor-Id": actorId }, signal: AbortSignal.timeout(20000) });
    if (!image.ok) throw Error("SIGNATURE_UNAVAILABLE");
    signature.image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(Error("SIGNATURE_UNAVAILABLE"));
      reader.onload = () => resolve(String(reader.result));
      void image.blob().then(blob => reader.readAsDataURL(blob), reject);
    });
  }
  return data;
}
export function newLocalReport(actorId: string, data: ReportDemoData): LocalReport {
  return {
    actorId, matchId: data.match.id, draftId: crypto.randomUUID(), editId: crypto.randomUUID(), revision: 0, acknowledgedRevision: 0,
    data, serverMatchStatus: data.match.status.code, expiresAt: Date.now() + OFFLINE_TTL, prepared: false, pending: [], updatedAt: new Date().toISOString(),
  };
}
export async function prepareLocalReport(actorId: string, matchId: string) {
  const data = await downloadOwnReport(actorId, matchId);
  await prepareReportResources();
  return initializeAuthorizedReport(actorId, data, true);
}
export async function initializeAuthorizedReport(actorId: string, data: ReportDemoData, prepared = false) {
  const prior = await renewLocalReportAccess(actorId, data.match.id);
  // Preparation must not replace any edits or intents from another tab.
  if (prior) {
    return updateLocalReport(actorId, data.match.id, record => ({ ...record, prepared: prepared || record.prepared, expiresAt: Date.now() + OFFLINE_TTL }));
  }
  const record = { ...newLocalReport(actorId, data), prepared };
  await writeLocalReport(record, null);
  return record;
}
