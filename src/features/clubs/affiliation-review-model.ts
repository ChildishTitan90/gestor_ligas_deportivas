/** Modelo de presentación conectado al contrato de revisión PDGLD-60. */
export type ReviewAction = "APPROVE" | "REQUEST_CORRECTIONS";
export type ReviewPhase = "AWAITING_REVIEW" | "CORRECTIONS_REQUESTED";
export type ReviewHistoryEntry = {
  id: string;
  action: "AFFILIATION_APPROVE" | "AFFILIATION_REQUEST_CORRECTIONS" | "AFFILIATION_RESUBMIT";
  occurredAt: string;
  observations: string | null;
};
export type ReviewSummary = {
  id: string;
  leagueId: string;
  referenceNumber: string;
  clubName: string;
  seasonName: string;
  version: number;
  status: "PENDING" | "APPROVED";
  reviewPhase: ReviewPhase | null;
};
export type ReviewDetail = ReviewSummary & {
  uniformColors: string;
  categories: string[];
  observations: string | null;
  allowedActions: ReviewAction[];
  history: ReviewHistoryEntry[];
  officers: {
    office: "PRESIDENT" | "SECRETARY" | "TREASURER";
    firstName: string;
    paternalSurname: string;
    maternalSurname: string;
    signatureFileId: string | null;
  }[];
};
export interface ReviewApi {
  list(leagueId: string): Promise<ReviewSummary[]>;
  detail(id: string): Promise<ReviewDetail>;
  review(id: string, action: ReviewAction, observations: string, expectedVersion: number): Promise<ReviewDetail>;
  signature(id: string): Promise<{ downloadUrl: string; expiresInSeconds: number }>;
}
export class ReviewApiError extends Error {
  constructor(public readonly kind: "unauthenticated" | "forbidden" | "conflict" | "unavailable" | "invalid-response") {
    super(kind);
  }
}
