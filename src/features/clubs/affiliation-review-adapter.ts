import { z } from "zod";
import { ReviewApiError, type ReviewApi, type ReviewAction, type ReviewDetail, type ReviewSummary } from "./affiliation-review-model";

// La versión procede del detalle autorizado, nunca se calcula para reenviar.
const summarySchema = z.object({
  id: z.uuid(), leagueId: z.uuid(), referenceNumber: z.string().min(1),
  clubName: z.string().min(1), seasonName: z.string().min(1),
  version: z.number().int().nonnegative(),
  status: z.enum(["PENDING", "APPROVED"]),
  reviewPhase: z.enum(["AWAITING_REVIEW", "CORRECTIONS_REQUESTED"]).nullable(),
}).refine(item => item.status !== "PENDING" || item.reviewPhase !== null);
const detailSchema = summarySchema.safeExtend({
  uniformColors: z.string(), categories: z.array(z.string()), observations: z.string().nullable(),
  allowedActions: z.array(z.enum(["APPROVE", "REQUEST_CORRECTIONS"])),
  history: z.array(z.object({
    id: z.uuid(),
    action: z.enum(["AFFILIATION_APPROVE", "AFFILIATION_REQUEST_CORRECTIONS", "AFFILIATION_RESUBMIT"]),
    occurredAt: z.iso.datetime(), observations: z.string().nullable(),
  })),
});

export function createReviewApi(request: typeof fetch = fetch): ReviewApi {
  async function read(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try { response = await request(path, { ...init, credentials: "same-origin", cache: "no-store" }); }
    catch { throw new ReviewApiError("unavailable"); }
    if (response.status === 401) throw new ReviewApiError("unauthenticated");
    if (response.status === 403) throw new ReviewApiError("forbidden");
    if (response.status === 409) {
      const body = await response.json().catch(() => null);
      if (["AFFILIATION_ALREADY_REVIEWED", "STALE_AFFILIATION", "CORRECTIONS_PENDING", "SEASON_CLOSED"].includes(body?.code))
        throw new ReviewApiError("conflict");
    }
    if (!response.ok) throw new ReviewApiError("unavailable");
    try { return await response.json(); }
    catch { throw new ReviewApiError("invalid-response"); }
  }
  function detail(value: unknown, id: string): ReviewDetail {
    const result = detailSchema.safeParse(value);
    if (!result.success || result.data.id !== id) throw new ReviewApiError("invalid-response");
    return result.data;
  }
  return {
    async list(leagueId) {
      if (!z.uuid().safeParse(leagueId).success) throw new ReviewApiError("invalid-response");
      const items: ReviewSummary[] = [];
      const ids = new Set<string>();
      for (let page = 1; page <= 10000; page++) {
        const value = await read(`/api/affiliations?${new URLSearchParams({ status: "PENDING", leagueId, page: String(page), pageSize: "100" })}`);
        const result = z.object({ items: z.array(summarySchema).max(100), page: z.literal(page),
          pageSize: z.literal(100), hasMore: z.boolean() }).safeParse(value);
        if (!result.success || (result.data.hasMore && result.data.items.length !== 100))
          throw new ReviewApiError("invalid-response");
        for (const item of result.data.items) {
          if (item.leagueId !== leagueId || item.status !== "PENDING" || ids.has(item.id))
            throw new ReviewApiError("invalid-response");
          ids.add(item.id); items.push(item);
        }
        if (!result.data.hasMore) return items;
      }
      throw new ReviewApiError("invalid-response");
    },
    async detail(id) { return detail(await read(`/api/affiliations/${encodeURIComponent(id)}`), id); },
    async review(id, action: ReviewAction, observations, expectedVersion) {
      const response = await read(`/api/affiliations/${encodeURIComponent(id)}/review`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "APPROVE" ? { decision: "APPROVE", expectedVersion } :
          { decision: "REQUEST_CORRECTIONS", observations: observations.trim(), expectedVersion }),
      });
      const saved = summarySchema.safeParse(response);
      if (!saved.success || saved.data.id !== id || saved.data.version !== expectedVersion + 1 ||
          (action === "APPROVE" ? saved.data.status !== "APPROVED" :
            saved.data.status !== "PENDING" || saved.data.reviewPhase !== "CORRECTIONS_REQUESTED"))
        throw new ReviewApiError("invalid-response");
      // PATCH confirma la escritura; GET obtiene el detalle y acciones vigentes.
      const result = detail(await read(`/api/affiliations/${encodeURIComponent(id)}`), id);
      return result;
    },
  };
}
