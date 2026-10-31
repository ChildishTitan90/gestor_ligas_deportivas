import { z } from "zod";
import { ReviewApiError, type ReviewApi, type ReviewAction, type ReviewDetail, type ReviewSummary } from "./affiliation-review-model";

export type ReviewState = {
  leagueId: string; status: ReviewSummary["status"]; items: ReviewSummary[]; detail: ReviewDetail | null;
  loading: boolean; detailLoading: boolean; submitting: boolean;
  loaded: boolean; confirming: boolean; observations: string; fieldError: string;
  selectedCategoryIds: string[]; categoryError: string;
  error: ReviewApiError["kind"] | null; errorContext: "list" | "detail" | "review" | "download"; message: string;
  downloading: boolean; download: { fileId: string; url: string; expiresAt: number } | null;
  pendingReview: { id: string; version: number; action: ReviewAction; observations: string; categoryIds: string[] } | null;
};
export function createReviewController(api: ReviewApi) {
  let state: ReviewState = { leagueId: "", status: "PENDING", items: [], detail: null, loading: false,
    detailLoading: false, submitting: false, loaded: false, confirming: false,
    observations: "", fieldError: "", selectedCategoryIds: [], categoryError: "", error: null, errorContext: "list", message: "", downloading: false, download: null, pendingReview: null };
  const listeners = new Set<() => void>();
  let generation = 0;
  function update(patch: Partial<ReviewState>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
  function fail(error: unknown, errorContext: ReviewState["errorContext"]) {
    const kind = error instanceof ReviewApiError ? error.kind : "unavailable";
    // No conservar datos privados tras pérdida de sesión o autorización.
    update({ error: kind, errorContext, confirming: false, download: null, ...(kind === "forbidden" || kind === "unauthenticated" ?
      { detail: null, items: [], observations: "", selectedCategoryIds: [], categoryError: "", pendingReview: null } : {}) });
  }
  async function load(leagueId: string, status: ReviewSummary["status"] = "PENDING") {
    if (state.submitting || state.pendingReview) return;
    const token = ++generation;
    update({ leagueId, status, items: [], detail: null, loaded: false, loading: true, detailLoading: false,
      error: null, message: "", confirming: false, observations: "", fieldError: "", selectedCategoryIds: [], categoryError: "", download: null, downloading: false });
    if (!z.uuid().safeParse(leagueId).success) {
      update({ loading: false, fieldError: "Escribe un identificador de liga válido." }); return;
    }
    try { const items = await api.list(leagueId, status); if (token === generation) update({ items, loaded: true }); }
    catch (error) { if (token === generation) fail(error, "list"); }
    finally { if (token === generation) update({ loading: false }); }
  }
  async function open(id: string) {
    if (state.submitting || state.pendingReview) return;
    const token = ++generation;
    update({ detail: null, detailLoading: true, confirming: false, observations: "", fieldError: "", selectedCategoryIds: [], categoryError: "", error: null, errorContext: "list", message: "", download: null, downloading: false });
    try {
      const detail = await api.detail(id);
      if (token === generation) {
        if (detail.leagueId !== state.leagueId) throw new ReviewApiError("invalid-response");
        update({ detail });
      }
    } catch (error) { if (token === generation) fail(error, "detail"); }
    finally { if (token === generation) update({ detailLoading: false }); }
  }
  async function submit(action: ReviewAction, confirmed = false, retry = false) {
    const detail = state.detail;
    if (!detail || state.submitting || state.detailLoading || state.downloading || (!retry && (state.error || state.pendingReview)) ||
        detail.status !== "PENDING" || !detail.allowedActions.includes(action)) return;
    const previous = retry ? state.pendingReview : null;
    if (retry && (!previous || previous.id !== detail.id)) return;
    const categoryIds = previous?.categoryIds ?? [...state.selectedCategoryIds];
    const observations = previous?.observations ?? state.observations;
    const expectedVersion = previous?.version ?? detail.version;
    if (action === "APPROVE") {
      if (!categoryIds.length || categoryIds.some(id => !detail.categoryOptions.some(c => c.id === id))) {
        update({ categoryError: "Selecciona al menos una categoría solicitada para autorizar.", confirming: false }); return;
      }
      if (!confirmed) { update({ confirming: true }); return; }
      if (!state.confirming && !retry) return;
    }
    if (action === "REQUEST_CORRECTIONS" && !observations.trim()) {
      update({ fieldError: "Escribe las observaciones para solicitar correcciones.", confirming: false }); return;
    }
    update({ submitting: true, confirming: false, fieldError: "", categoryError: "", message: "", download: null,
      pendingReview: { id: detail.id, version: expectedVersion, action, observations, categoryIds } });
    let errorContext: ReviewState["errorContext"] = "review";
    try {
      const result = await api.review(detail.id, action, observations, expectedVersion, categoryIds);
      if (result.leagueId !== state.leagueId) throw new ReviewApiError("invalid-response");
      update({ detail: result, observations: "", selectedCategoryIds: [], pendingReview: null, error: null, message: action === "APPROVE" ?
        "Aprobación confirmada por el servidor." : "Solicitud de correcciones confirmada por el servidor." });
      // Una escritura confirmada requiere volver a consultar la bandeja.
      errorContext = "list";
      update({ items: await api.list(state.leagueId, state.status) });
    } catch (error) {
      if (error instanceof ReviewApiError && error.kind === "conflict") {
        update({ detail: null, items: [], selectedCategoryIds: [], pendingReview: null, message: "Otra persona ya revisó esta solicitud. Consultando el resultado actual…" });
        let refreshContext: ReviewState["errorContext"] = "detail";
        try {
          const result = await api.detail(detail.id);
          if (result.leagueId !== state.leagueId) throw new ReviewApiError("invalid-response");
          refreshContext = "list";
          const items = await api.list(state.leagueId, state.status);
          update({ detail: result, items, observations: "", message: "Otra persona ya revisó esta solicitud. Se muestra el resultado actual del servidor." });
        } catch (refreshError) { fail(refreshError, refreshContext); }
      } else { fail(error, errorContext); }
    } finally { update({ submitting: false }); }
  }
  async function reconcile() {
    const pending = state.pendingReview;
    if (!pending || state.submitting || state.detailLoading) return;
    update({ detailLoading: true, message: "Consultando el resultado sin reenviar la revisión…" });
    try {
      const result = await api.detail(pending.id);
      if (result.leagueId !== state.leagueId || result.version < pending.version) throw new ReviewApiError("invalid-response");
      if (result.version === pending.version) {
        update({ message: "El resultado todavía no está confirmado. Conservamos el envío; puedes volver a consultar o reintentar exactamente la misma revisión." });
        return;
      }
      update({ detail: result, pendingReview: null, observations: "", selectedCategoryIds: [], error: null,
        message: "Se consultó el estado actual del servidor. Revisa el resultado y su historial antes de otra operación." });
      try { update({ items: await api.list(state.leagueId, state.status) }); }
      catch (error) { fail(error, "list"); }
    } catch (error) { fail(error, "review"); }
    finally { update({ detailLoading: false }); }
  }
  async function signature(fileId: string) {
    if (!state.detail || state.submitting || state.downloading || state.confirming || state.error ||
        !state.detail.officers.some(officer => officer.signatureFileId === fileId)) return;
    const token = generation;
    update({ downloading: true, download: null });
    try {
      const result = await api.signature(fileId);
      if (token === generation) update({ download: { fileId, url: result.downloadUrl,
        expiresAt: Date.now() + result.expiresInSeconds * 1000 } });
    } catch (error) { if (token === generation) fail(error, "download"); }
    finally { if (token === generation) update({ downloading: false }); }
  }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    load, open, submit: (action: ReviewAction) => submit(action),
    confirmApproval: () => submit("APPROVE", true),
    reconcile,
    retryReview: () => state.pendingReview ? submit(state.pendingReview.action, true, true) : Promise.resolve(),
    observations: (value: string) => { if (!state.submitting && !state.pendingReview) update({ observations: value, fieldError: "" }); },
    category: (id: string, selected: boolean) => {
      if (state.submitting || state.confirming || state.error || state.downloading || !state.detail?.allowedActions.includes("APPROVE") ||
          state.detail.status !== "PENDING" || !state.detail.categoryOptions.some(c => c.id === id)) return;
      update({ selectedCategoryIds: selected ? [...new Set([...state.selectedCategoryIds, id])] : state.selectedCategoryIds.filter(item => item !== id), categoryError: "" });
    },
    cancel: () => { if (!state.submitting) update({ confirming: false }); },
    signature, clearDownload: () => update({ download: null }),
  };
}
export type ReviewController = ReturnType<typeof createReviewController>;
