import type { ReviewSummary } from "./affiliation-review-model";

export type ReviewFilters = { search: string; season: string; phase: "ALL" | "AWAITING_REVIEW" | "CORRECTIONS_REQUESTED"; page: number };
export const emptyReviewFilters: ReviewFilters = { search: "", season: "", phase: "ALL", page: 1 };
export const reviewPageSize = 10;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
export function reviewSeasonKey(item: ReviewSummary) { return item.seasonId ?? item.seasonName; }

/** La colección proviene del adaptador que comprueba y reúne todas las páginas autorizadas. */
export function filterReviewItems(items: readonly ReviewSummary[], filters: ReviewFilters) {
  const search = normalize(filters.search);
  const filtered = items.filter(item => (!search || normalize(`${item.referenceNumber} ${item.clubName}`).includes(search)) &&
    (!filters.season || reviewSeasonKey(item) === filters.season) &&
    (filters.phase === "ALL" || item.reviewPhase === filters.phase));
  const pages = Math.max(1, Math.ceil(filtered.length / reviewPageSize));
  const page = Math.max(1, Math.min(filters.page, pages));
  return { total: filtered.length, page, pages, items: filtered.slice((page - 1) * reviewPageSize, page * reviewPageSize) };
}
