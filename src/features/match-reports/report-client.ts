import type { ReportDemoData, MatchReportPresentation } from "./types";
import type { ReportCommand, ReportDraft, ReportReceipt } from "./contract";
import type { ClockAction } from "./match-clock";

export class ReportClientError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
type Operation = { id: string; kind: "save" | "lock-lineups" | "clock" | "confirm"; clockAction?: ClockAction; expectedReportVersion: number; expectedMatchVersion: number; snapshot: MatchReportPresentation };
export function createReportClient(actorId: string, data: ReportDemoData) {
  const attempts = new Map<string, { command: ReportCommand; uploads: { teamId: string; captainId: string; operationId: string; image: string }[] }>();
  async function json(path: string, body?: unknown) {
    const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", headers: { "Content-Type": "application/json", "X-Expected-Actor-Id": actorId }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new ReportClientError(result.code ?? "OPERATION_UNAVAILABLE", response.status);
    return result;
  }
  const base = `/api/match-reports/${data.match.id}`;
  return {
    async send(op: Operation): Promise<ReportReceipt> {
      let attempt = attempts.get(op.id);
      if (!attempt) {
        const draft: ReportDraft = { lineups: op.snapshot.lineups.map(row => ({ ...row, teamId: data.players.find(p => p.id === row.playerId)!.teamId })), captains: op.snapshot.captains, events: op.snapshot.events, score: op.snapshot.score, remarks: op.snapshot.remarks, incidents: op.snapshot.incidents, signatures: {}, ...(op.snapshot.tactics ? { tactics: op.snapshot.tactics } : {}) };
        const uploads: { teamId: string; captainId: string; operationId: string; image: string }[] = [];
        for (const teamId of [data.match.home.id, data.match.away.id]) {
          const signature = op.snapshot.signatures[teamId];
          if (signature?.image.startsWith("data:image/png;base64,")) uploads.push({ teamId, captainId: signature.captainId, operationId: crypto.randomUUID(), image: signature.image });
          else if (signature?.image.startsWith(`${base}/signatures/`)) draft.signatures[teamId] = signature.image.split("/").at(-1)!;
        }
        attempt = { command: { formatVersion: 1, operationId: op.id, matchId: data.match.id, kind: op.kind, ...(op.clockAction ? { clockAction: op.clockAction } : {}), expectedMatchVersion: op.expectedMatchVersion, expectedReportVersion: op.expectedReportVersion, draft }, uploads };
        attempts.set(op.id, attempt);
      }
      for (const upload of attempt.uploads) {
        if (attempt.command.draft.signatures[upload.teamId]) continue;
        const result = await json(`${base}/signatures`, { ...upload, matchId: data.match.id, expectedMatchVersion: op.expectedMatchVersion, expectedReportVersion: op.expectedReportVersion, draft: attempt.command.draft });
        attempt.command.draft.signatures[upload.teamId] = result.fileId;
      }
      return json(base, attempt.command);
    },
    query(operationId: string): Promise<{ status: "UNKNOWN" | "APPLIED"; receipt?: ReportReceipt }> { return json(`${base}?operationId=${encodeURIComponent(operationId)}`); },
    signatureReferences(operationId: string) { return { ...attempts.get(operationId)?.command.draft.signatures }; },
  };
}
