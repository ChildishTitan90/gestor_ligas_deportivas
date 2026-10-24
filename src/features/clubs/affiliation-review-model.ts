/** Modelo provisional de presentación PDGLD-61; no es el contrato de PDGLD-60. */
export type ReviewAction = "APPROVE" | "REQUEST_CORRECTIONS";
export type ReviewPhase = "AWAITING_REVIEW" | "CORRECTIONS_REQUESTED";
export type ReviewSummary = {
  id: string;
  leagueId: string;
  referenceNumber: string;
  clubName: string;
  seasonName: string;
  status: "PENDING" | "APPROVED";
  reviewPhase: ReviewPhase | null;
};
export type ReviewDetail = ReviewSummary & {
  uniformColors: string;
  categories: string[];
  observations: string | null;
  allowedActions: ReviewAction[];
};
export interface ReviewApi {
  list(leagueId: string): Promise<ReviewSummary[]>;
  detail(id: string): Promise<ReviewDetail>;
  review(id: string, action: ReviewAction, observations: string): Promise<ReviewDetail>;
}
export class ReviewApiError extends Error {
  constructor(public readonly kind: "unauthenticated" | "forbidden" | "conflict" | "unavailable" | "invalid-response") {
    super(kind);
  }
}
