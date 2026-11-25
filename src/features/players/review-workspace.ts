import { z } from "zod";

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

export type PlayerReviewKind = "IDENTITY" | "INE" | "DOCUMENTS" | "AGE_EXCEPTION";
export type PlayerReviewItem = PlayerReviewLabels & {
  kind: PlayerReviewKind;
  reason: string;
};
export type PlayerReviewFilters = { kind: "ALL" | PlayerReviewKind; clubId: string; seasonId: string };
export const emptyPlayerReviewFilters: PlayerReviewFilters = { kind: "ALL", clubId: "", seasonId: "" };

const reviewQuery = z.object({
  tipo: z.enum(["ALL", "IDENTITY", "INE", "DOCUMENTS", "AGE_EXCEPTION"]).catch("ALL"),
  club: z.uuid().catch(""),
  temporada: z.uuid().catch(""),
});

export function parsePlayerReviewFilters(params: Record<string, string | string[] | undefined>): PlayerReviewFilters {
  const { tipo, club, temporada } = reviewQuery.parse(params);
  return { kind: tipo, clubId: club, seasonId: temporada };
}

export function playerReviewFilterQuery({ kind, clubId, seasonId }: PlayerReviewFilters): string {
  const params = new URLSearchParams();
  if (kind !== "ALL") params.set("tipo", kind);
  if (clubId) params.set("club", clubId);
  if (seasonId) params.set("temporada", seasonId);
  return params.size ? `?${params}` : "";
}

export function playerReviewReturnHref(params: Record<string, string | string[] | undefined>) {
  return `/players/review${playerReviewFilterQuery(parsePlayerReviewFilters(params))}#casos-revision`;
}
