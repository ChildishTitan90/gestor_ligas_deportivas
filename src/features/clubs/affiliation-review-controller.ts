import { z } from "zod";
import { ReviewApiError, type ReviewApi, type ReviewAction, type ReviewDetail, type ReviewSummary } from "./affiliation-review-model";

export type ReviewState = {
  leagueId: string; items: ReviewSummary[]; detail: ReviewDetail | null;
  loading: boolean; detailLoading: boolean; submitting: boolean;
  loaded: boolean; confirming: boolean; observations: string; fieldError: string;
  error: ReviewApiError["kind"] | null; errorContext: "list" | "detail" | "review"; message: string;
};
export function createReviewController(api: ReviewApi) {
  let state: ReviewState = { leagueId: "", items: [], detail: null, loading: false,
    detailLoading: false, submitting: false, loaded: false, confirming: false,
    observations: "", fieldError: "", error: null, errorContext: "list", message: "" };
  const listeners = new Set<() => void>();
  let generation = 0;
  function update(patch: Partial<ReviewState>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
  function fail(error: unknown, errorContext: ReviewState["errorContext"]) {
    const kind = error instanceof ReviewApiError ? error.kind : "unavailable";
    // No conservar datos privados tras pérdida de sesión o autorización.
    update({ error: kind, errorContext, confirming: false, ...(kind === "forbidden" || kind === "unauthenticated" ?
      { detail: null, items: [], observations: "" } : {}) });
  }
  async function load(leagueId: string) {
    if (state.submitting) return;
    const token = ++generation;
    update({ leagueId, items: [], detail: null, loaded: false, loading: true, detailLoading: false,
      error: null, message: "", confirming: false, observations: "", fieldError: "" });
    if (!z.uuid().safeParse(leagueId).success) {
      update({ loading: false, fieldError: "Escribe un identificador de liga válido." }); return;
    }
    try { const items = await api.list(leagueId); if (token === generation) update({ items, loaded: true }); }
    catch (error) { if (token === generation) fail(error, "list"); }
    finally { if (token === generation) update({ loading: false }); }
  }
  async function open(id: string) {
    if (state.submitting) return;
    const token = ++generation;
    update({ detail: null, detailLoading: true, confirming: false, observations: "", fieldError: "", error: null, errorContext: "list", message: "" });
    try {
      const detail = await api.detail(id);
      if (token === generation) {
        if (detail.leagueId !== state.leagueId) throw new ReviewApiError("invalid-response");
        update({ detail });
      }
    } catch (error) { if (token === generation) fail(error, "detail"); }
    finally { if (token === generation) update({ detailLoading: false }); }
  }
  async function submit(action: ReviewAction, confirmed = false) {
    const detail = state.detail;
    if (!detail || state.submitting || state.error || detail.status !== "PENDING" || !detail.allowedActions.includes(action)) return;
    if (action === "APPROVE") {
      if (!confirmed) { update({ confirming: true }); return; }
      if (!state.confirming) return;
    }
    if (action === "REQUEST_CORRECTIONS" && !state.observations.trim()) {
      update({ fieldError: "Escribe las observaciones para solicitar correcciones.", confirming: false }); return;
    }
    update({ submitting: true, confirming: false, fieldError: "", message: "" });
    let errorContext: ReviewState["errorContext"] = "review";
    try {
      const result = await api.review(detail.id, action, state.observations, detail.version);
      if (result.leagueId !== state.leagueId) throw new ReviewApiError("invalid-response");
      update({ detail: result, observations: "", message: action === "APPROVE" ?
        "Aprobación confirmada por el servidor." : "Solicitud de correcciones confirmada por el servidor." });
      // Una escritura confirmada requiere volver a consultar la bandeja.
      errorContext = "list";
      update({ items: await api.list(state.leagueId) });
    } catch (error) {
      if (error instanceof ReviewApiError && error.kind === "conflict") {
        update({ detail: null, items: [], message: "Otra persona ya revisó esta solicitud. Consultando el resultado actual…" });
        let refreshContext: ReviewState["errorContext"] = "detail";
        try {
          const result = await api.detail(detail.id);
          if (result.leagueId !== state.leagueId) throw new ReviewApiError("invalid-response");
          refreshContext = "list";
          const items = await api.list(state.leagueId);
          update({ detail: result, items, observations: "", message: "Otra persona ya revisó esta solicitud. Se muestra el resultado actual del servidor." });
        } catch (refreshError) { fail(refreshError, refreshContext); }
      } else { fail(error, errorContext); }
    } finally { update({ submitting: false }); }
  }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    load, open, submit: (action: ReviewAction) => submit(action),
    confirmApproval: () => submit("APPROVE", true),
    observations: (value: string) => { if (!state.submitting) update({ observations: value, fieldError: "" }); },
    cancel: () => { if (!state.submitting) update({ confirming: false }); },
  };
}
export type ReviewController = ReturnType<typeof createReviewController>;
