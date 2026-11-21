import type { ReportDemoData, MatchReportPresentation } from "./types";
import type { ReportCommand, ReportDraft, ReportReceipt } from "./contract";
import type { ClockAction } from "./match-clock";

// A LAN development origin can supply secure random bytes without randomUUID.
export function reportUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export class ReportClientError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
export type ReportOperation = { id: string; kind: "save" | "lock-lineups" | "clock" | "confirm" | "record-no-show"; clockAction?: ClockAction; occurredAt?: string; expectedReportVersion: number; expectedMatchVersion: number; snapshot: MatchReportPresentation };
export type ReportAttempt = { command: ReportCommand; uploads: { teamId: string; captainId: string; operationId: string; image: string }[] };
export function prepareReportAttempt(data: ReportDemoData, op: ReportOperation): ReportAttempt {
  const base = `/api/match-reports/${data.match.id}`;
  const draft: ReportDraft = { lineups: op.snapshot.lineups.map(row => {
    const player = data.players.find(p => p.id === row.playerId);
    if (!player) throw new ReportClientError("EVENT_PLAYER_OUT_OF_SCOPE", 400);
    return { ...row, teamId: player.teamId };
  }), captains: op.snapshot.captains, events: op.snapshot.events, score: op.snapshot.score, remarks: op.snapshot.remarks, incidents: op.snapshot.incidents, signatures: {}, ...(op.snapshot.tactics ? { tactics: op.snapshot.tactics } : {}), ...(op.snapshot.noShow ? { noShow: op.snapshot.noShow } : {}) };
  const uploads: ReportAttempt["uploads"] = [];
  for (const teamId of [data.match.home.id, data.match.away.id]) {
    const signature = op.snapshot.signatures[teamId];
    if (signature?.fileId) draft.signatures[teamId] = signature.fileId;
    else if (signature?.image.startsWith("data:image/png;base64,")) uploads.push({ teamId, captainId: signature.captainId, operationId: reportUuid(), image: signature.image });
    else if (signature?.image.startsWith(`${base}/signatures/`)) draft.signatures[teamId] = signature.image.split("/").at(-1)!;
  }
  return { command: { formatVersion: 1, operationId: op.id, matchId: data.match.id, kind: op.kind, ...(op.clockAction ? { clockAction: op.clockAction } : {}), ...(op.occurredAt ? { occurredAt: op.occurredAt } : {}), expectedMatchVersion: op.expectedMatchVersion, expectedReportVersion: op.expectedReportVersion, draft }, uploads };
}
export function createReportClient(actorId: string, data: ReportDemoData, durable?: {
  load(id: string): Promise<ReportAttempt | undefined>;
  save(id: string, attempt: ReportAttempt): Promise<void>;
}) {
  const attempts = new Map<string, ReportAttempt>();
  async function json(path: string, body?: unknown, liveClock = false) {
    const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json", "X-Expected-Actor-Id": actorId, ...(liveClock ? { "X-Report-Live-Clock": "1" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new ReportClientError(result.code ?? "OPERATION_UNAVAILABLE", response.status);
    return result;
  }
  const base = `/api/match-reports/${data.match.id}`;
  return {
    async send(op: ReportOperation, liveClock = false): Promise<ReportReceipt> {
      let attempt = attempts.get(op.id) ?? await durable?.load(op.id);
      if (!attempt) {
        attempt = prepareReportAttempt(data, op);
        await durable?.save(op.id, attempt);
      }
      attempts.set(op.id, attempt);
      for (const upload of attempt.uploads) {
        if (attempt.command.draft.signatures[upload.teamId]) continue;
        const result = await json(`${base}/signatures`, { ...upload, matchId: data.match.id, expectedMatchVersion: op.expectedMatchVersion, expectedReportVersion: op.expectedReportVersion, draft: attempt.command.draft });
        attempt.command.draft.signatures[upload.teamId] = result.fileId;
        await durable?.save(op.id, attempt);
      }
      return json(durable && !liveClock ? "/api/v1/match-reports/sync" : base, attempt.command, liveClock);
    },
    query(operationId: string): Promise<{ status: "UNKNOWN" | "APPLIED"; receipt?: ReportReceipt }> {
      return json(durable ? `/api/v1/match-reports/sync?matchId=${data.match.id}&operationId=${encodeURIComponent(operationId)}` : `${base}?operationId=${encodeURIComponent(operationId)}`);
    },
    signatureReferences(operationId: string) { return { ...attempts.get(operationId)?.command.draft.signatures }; },
  };
}
