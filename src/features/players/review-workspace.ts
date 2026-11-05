/** Datos mínimos de una inscripción que el servidor ya autorizó para revisión. */
export type PlayerReviewLabels = {
  id: string;
  name: string;
  team: string;
  clubId: string;
  club: string;
  seasonId: string;
  season: string;
  category: string;
  registeredAt: string;
};

export type PlayerReviewKind = "IDENTITY" | "INE" | "DOCUMENTS";
export type PlayerReviewItem = PlayerReviewLabels & {
  kind: PlayerReviewKind;
  reason: string;
};
