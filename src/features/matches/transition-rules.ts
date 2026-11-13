import type { TransitionInput } from "./schemas";

export class MatchTransitionError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

export type MatchSnapshot = {
  status: string; version: number; deleted: boolean; seasonStatus: string;
  venueId: string | null; startsAt: Date | null; endsAt: Date | null; reservedUntil: Date | null;
};

/** Primera entrega: los demás caminos requieren su contrato de dominio. */
export function assertTransition(snapshot: MatchSnapshot, input: TransitionInput) {
  if (snapshot.deleted) throw new MatchTransitionError("MATCH_UNAVAILABLE", 404);
  if (snapshot.seasonStatus === "CLOSED") throw new MatchTransitionError("SEASON_CLOSED");
  if (snapshot.version !== input.expectedVersion) throw new MatchTransitionError("STALE_MATCH");
  if (!allowedPair(snapshot.status, input.toStatus))
    throw new MatchTransitionError("TRANSITION_NOT_IMPLEMENTED");
  if (input.toStatus === "CANCELED") return;
  const { venueId, startsAt, endsAt, reservedUntil } = snapshot;
  if (!venueId || !startsAt || !endsAt || !reservedUntil ||
      ![startsAt, endsAt, reservedUntil].every(date => Number.isFinite(date.getTime())) ||
      endsAt <= startsAt || reservedUntil < endsAt)
    throw new MatchTransitionError("SCHEDULE_REQUIRED");
}

export function allowedPair(from: string, to: string) {
  return (from === "DRAFT" && to === "SCHEDULED") || (from === "SCHEDULED" && to === "CONFIRMED") ||
    (from === "CONFIRMED" && to === "IN_PROGRESS") || (from === "IN_PROGRESS" && to === "SUSPENDED") ||
    (["SCHEDULED", "CONFIRMED", "SUSPENDED"].includes(from) && to === "CANCELED");
}

export type TransitionReceipt = {
  id: string; matchId: string; actorId: string; fromStatus: string; toStatus: string;
  expectedVersion: number | null; reason: string; createdAt: Date;
};

export function assertReplay(receipt: TransitionReceipt, actorId: string, input: TransitionInput) {
  if (receipt.matchId !== input.matchId || receipt.actorId !== actorId ||
      !allowedPair(receipt.fromStatus, receipt.toStatus) || receipt.toStatus !== input.toStatus ||
      receipt.expectedVersion !== input.expectedVersion || receipt.reason !== input.reason)
    throw new MatchTransitionError("IDEMPOTENCY_CONFLICT");
}

export function receiptDto(receipt: TransitionReceipt, replayed: boolean) {
  return {
    operationId: receipt.id, matchId: receipt.matchId, toStatus: receipt.toStatus,
    appliedVersion: receipt.expectedVersion! + 1, occurredAt: receipt.createdAt.toISOString(), replayed,
  };
}
