import { z } from "zod";
import { ReviewApiError, type ReviewApi, type ReviewAction, type ReviewDetail } from "./affiliation-review-model";

// Respuestas provisionales pendientes de Sergio; cuerpo PATCH confirmado con decision.
const summarySchema = z.object({
  id: z.uuid(), leagueId: z.uuid(), referenceNumber: z.string().min(1),
  clubName: z.string().min(1), seasonName: z.string().min(1),
  status: z.enum(["PENDING", "APPROVED"]),
  reviewPhase: z.enum(["AWAITING_REVIEW", "CORRECTIONS_REQUESTED"]).nullable(),
}).refine(item => item.status !== "PENDING" || item.reviewPhase !== null);
const detailSchema = summarySchema.safeExtend({
  uniformColors: z.string(), categories: z.array(z.string()), observations: z.string().nullable(),
  allowedActions: z.array(z.enum(["APPROVE", "REQUEST_CORRECTIONS"])),
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
      if (body?.code === "AFFILIATION_ALREADY_REVIEWED") throw new ReviewApiError("conflict");
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
      const value = await read(`/api/affiliations?${new URLSearchParams({ status: "PENDING", leagueId })}`);
      const result = z.object({ items: z.array(summarySchema) }).safeParse(value);
      if (!result.success || result.data.items.some(item => item.leagueId !== leagueId || item.status !== "PENDING") ||
        new Set(result.data.items.map(item => item.id)).size !== result.data.items.length) throw new ReviewApiError("invalid-response");
      return result.data.items;
    },
    async detail(id) { return detail(await read(`/api/affiliations/${encodeURIComponent(id)}`), id); },
    async review(id, action: ReviewAction, observations) {
      const result = detail(await read(`/api/affiliations/${encodeURIComponent(id)}/review`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "APPROVE" ? { decision: "APPROVE" } :
          { decision: "REQUEST_CORRECTIONS", observations: observations.trim() }),
      }), id);
      if (action === "APPROVE" ? result.status !== "APPROVED" :
        result.status !== "PENDING" || result.reviewPhase !== "CORRECTIONS_REQUESTED") throw new ReviewApiError("invalid-response");
      return result;
    },
  };
}
