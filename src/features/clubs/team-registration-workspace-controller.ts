import { createTeamRegistrationFormController, registrationChoices } from "./team-registration-form-controller";
import { EnrollmentReadError, enrollmentMessage, pendingCapture, registrationOptions, type EnrollmentApi, type EnrollmentOptions } from "./team-registration-adapter";
import type { TeamRegistrationItem } from "./team-registration-model";

export function createRegistrationWorkspace(api: EnrollmentApi) {
  const empty = () => ({ loading: true, optionsError: "", listError: "", listLoading: false, listed: false,
    formVisible: false, blocked: false, formClosed: false, closeConfirm: false, closeBusy: false, closeError: "",
    operationBusy: false, operationMessage: "", cancelConfirm: false,
    catalogLoading: false, catalogError: "", queryClubId: "", querySeasonId: "",
    queryClubs: [] as EnrollmentOptions["clubs"], querySeasons: [] as EnrollmentOptions["seasons"],
    clubId: "", seasonId: "", listClubId: "", listSeasonId: "", nextAfter: null as string | null,
    items: [] as TeamRegistrationItem[], seasons: [] as EnrollmentOptions["seasons"] });
  let state = empty();
  let optionsAbort: AbortController | undefined;
  let listAbort: AbortController | undefined;
  let catalogAbort: AbortController | undefined;
  let operationAbort: AbortController | undefined;
  let catalogVersion = 0;
  let active = true;
  let epoch = 0;
  let optionsVersion = 0;
  let listVersion = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const message = (error: unknown) => enrollmentMessage(error instanceof EnrollmentReadError ? error.code : "UNAVAILABLE");
  function cancel() { ++optionsVersion; ++listVersion; optionsAbort?.abort(); listAbort?.abort(); catalogAbort?.abort(); operationAbort?.abort(); ++catalogVersion; }
  function hide(error: unknown) {
    cancel(); api.stop(); ++epoch; form.conceal();
    publish({ ...empty(), loading: false, blocked: true, optionsError: message(error) });
  }
  const denied = (error: unknown) => error instanceof EnrollmentReadError && [401, 403].includes(error.status);
  const submit: EnrollmentApi["submit"] = async capture => {
    if (!active || !state.formVisible || state.blocked || state.loading || state.formClosed || state.closeBusy || state.operationBusy)
      return { kind: "unconfirmed", message: "Comprueba sesión y acceso antes de enviar o recuperar la inscripción." };
    if (!registrationChoices(form.getSnapshot().options, form.getSnapshot().draft).season?.canEnroll)
      return { kind: "unconfirmed", message: "No tienes permiso vigente para inscribir. Conservamos el pendiente; puedes consultar o cancelar la intención." };
    const version = epoch;
    publish({ operationMessage: "" });
    try {
      const result = await api.submit(capture);
      if (!active || version !== epoch) return { kind: "unconfirmed" };
      if (result.kind === "confirmed" || result.kind === "correctable") void list(capture.clubId, capture.seasonId);
      return result;
    } catch (error) {
      if (active && version === epoch) hide(error);
      return { kind: "unconfirmed" };
    }
  };
  const form = createTeamRegistrationFormController({ clubs: [] }, submit);
  async function options(clubId = state.clubId, seasonId = state.seasonId) {
    if (!active || state.formClosed) return;
    optionsAbort?.abort(); optionsAbort = new AbortController();
    ++listVersion; listAbort?.abort();
    const version = ++optionsVersion;
    publish({ loading: true, optionsError: "", items: [], listed: false, nextAfter: null, listLoading: false, listError: "" });
    try {
      const data = await api.options(clubId, seasonId, optionsAbort.signal);
      if (!active || version !== optionsVersion) return;
      if (clubId && !data.clubs.some(club => club.id === clubId)) throw new EnrollmentReadError("FORBIDDEN", 403);
      form.configure(registrationOptions(data, clubId, seasonId), submit);
      publish({ seasons: data.seasons, clubId, seasonId, formVisible: true, blocked: false });
    } catch (error) {
      if (active && version === optionsVersion) {
        if (denied(error)) hide(error);
        else publish({ optionsError: message(error), formVisible: false });
      }
    } finally { if (active && version === optionsVersion) publish({ loading: false }); }
  }
  async function list(clubId: string, seasonId = "", more = false) {
    if (!active || !clubId) return;
    if (state.blocked) api.start();
    listAbort?.abort(); listAbort = new AbortController();
    const version = ++listVersion;
    const after = more ? state.nextAfter ?? "" : "";
    publish({ listClubId: clubId, listSeasonId: seasonId, listLoading: true, listError: "", ...(more ? {} : { items: [], listed: false, nextAfter: null }) });
    try {
      const result = await api.list(clubId, seasonId, after, listAbort.signal);
      if (!active || version !== listVersion) return;
      publish({ items: more ? [...state.items, ...result.items.filter(item => !state.items.some(old => old.seasonTeamId === item.seasonTeamId))] : result.items,
        nextAfter: result.nextAfter, listed: true });
    } catch (error) {
      if (active && version === listVersion) {
        if (denied(error)) hide(error);
        else publish({ listError: message(error) });
      }
    } finally { if (active && version === listVersion) publish({ listLoading: false }); }
  }
  async function queryCatalogs(clubId = state.queryClubId, seasonId = state.querySeasonId) {
    if (!active) return;
    catalogAbort?.abort(); catalogAbort = new AbortController(); const version = ++catalogVersion;
    ++listVersion; listAbort?.abort();
    publish({ catalogLoading: true, catalogError: "", queryClubId: clubId, querySeasonId: seasonId,
      querySeasons: [], items: [], listed: false, nextAfter: null, listLoading: false, listError: "" });
    try {
      const data = await api.catalogs(clubId, seasonId, catalogAbort.signal);
      if (!active || version !== catalogVersion) return;
      if (clubId && !data.clubs.some(club => club.id === clubId)) throw new EnrollmentReadError("FORBIDDEN", 403);
      publish({ queryClubs: data.clubs, querySeasons: data.seasons });
    } catch (error) {
      if (active && version === catalogVersion) {
        if (denied(error)) hide(error); else publish({ catalogError: message(error) });
      }
    } finally { if (active && version === catalogVersion) publish({ catalogLoading: false }); }
  }
  async function resolveOperation(action: "check" | "cancel") {
    const snapshot = form.getSnapshot();
    if (!active || !state.formVisible || state.blocked || state.operationBusy || state.loading || state.closeBusy ||
      snapshot.submitting || (snapshot.outcome !== "unconfirmed" && !snapshot.pendingCleanup) || (action === "cancel" && !state.cancelConfirm)) return;
    const version = epoch;
    operationAbort = new AbortController();
    publish({ operationBusy: true, operationMessage: "", cancelConfirm: false });
    try {
      const payload = api.pending();
      const result = action === "check" ? await api.check(operationAbort.signal) : await api.cancel();
      if (!active || version !== epoch) return;
      form.settle(result);
      publish({ operationMessage: form.getSnapshot().message });
      if (result.kind === "confirmed" && payload) void list(payload.clubId, payload.seasonId);
    } catch (error) {
      if (active && version === epoch) {
        if (denied(error)) hide(error);
        else publish({ operationMessage: "No se pudo comprobar el resultado. Conservamos cuerpo y clave; vuelve a consultar." });
      }
    } finally { if (active && version === epoch) publish({ operationBusy: false }); }
  }
  return {
    form, queryCatalogs,
    checkOperation: () => resolveOperation("check"),
    requestCancellation() { if (state.formVisible && !state.operationBusy && !state.closeBusy && !form.getSnapshot().submitting && form.getSnapshot().outcome === "unconfirmed") publish({ cancelConfirm: true }); },
    dismissCancellation() { if (!state.operationBusy) publish({ cancelConfirm: false }); },
    confirmCancellation: () => resolveOperation("cancel"), getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async initialize() {
      cancel(); const version = ++epoch; active = true; api.start(); form.conceal(); publish(empty());
      try {
        await api.identity();
        if (!active || version !== epoch) return;
        if (api.unresolved()) {
          publish({ loading: false, blocked: true, formClosed: true,
            optionsError: "Existe un bloqueo de una versión anterior sin resultado resuelto. No se habilita otra inscripción." });
          return;
        }
        const pending = api.pending();
        if (!pending) { form.begin(); await options(); if (active && version === epoch && !state.blocked) await queryCatalogs("", ""); return; }
        optionsAbort = new AbortController();
        // Validar identidad y READ en el contexto ANTES de restaurar ningún campo.
        const data = await api.options(pending.clubId, pending.seasonId, optionsAbort.signal);
        if (!active || version !== epoch) return;
        if (!data.clubs.some(club => club.id === pending.clubId)) throw new EnrollmentReadError("FORBIDDEN", 403);
        await api.list(pending.clubId, pending.seasonId, "", optionsAbort.signal);
        if (!active || version !== epoch) return;
        form.configure(registrationOptions(data, pending.clubId, pending.seasonId), submit);
        form.restore(pendingCapture(pending));
        publish({ loading: false, formVisible: true, seasons: data.seasons, clubId: pending.clubId, seasonId: pending.seasonId });
        await queryCatalogs(pending.clubId, "");
      } catch (error) {
        if (active && version === epoch) hide(error);
      }
    },
    async context(clubId: string, seasonId: string) {
      publish({ operationMessage: "" });
      await options(clubId, seasonId);
      if (active && state.formVisible && state.clubId === clubId && state.seasonId === seasonId && clubId) await list(clubId, seasonId);
    },
    requestClose() {
      if (state.formVisible && !state.operationBusy && !state.closeBusy && !form.getSnapshot().submitting && form.getSnapshot().outcome === "unconfirmed")
        publish({ closeConfirm: true, closeError: "" });
    },
    cancelClose() { if (!state.closeBusy) publish({ closeConfirm: false }); },
    async confirmClose() {
      if (!active || !state.closeConfirm || state.closeBusy || state.operationBusy || form.getSnapshot().submitting) return;
      const version = epoch; publish({ closeBusy: true, closeError: "" });
      try {
        await api.closePending();
        if (!active || version !== epoch) return;
        cancel(); form.conceal(); publish({ ...empty(), loading: false, formClosed: true, blocked: true,
          optionsError: "Formulario cerrado. Conservamos el cuerpo y la clave del envío pendiente en esta pestaña. Cerrar no cancela la operación ni confirma su resultado; no puedes iniciar otra inscripción hasta resolverlo." });
      } catch (error) {
        if (active && version === epoch) {
          if (denied(error)) hide(error);
          else { form.conceal(); publish({ formVisible: false, blocked: true, closeConfirm: false,
            closeError: "No se pudo comprobar el pendiente. No se eliminó su cuerpo ni su clave; comprueba el acceso y el almacenamiento antes de retomarlo." }); }
        }
      } finally { if (active && version === epoch) publish({ closeBusy: false }); }
    },
    reloadOptions: () => state.blocked || !state.formVisible ? Promise.resolve() : options(), list,
    dispose() { active = false; ++epoch; cancel(); api.stop(); form.conceal(); state = { ...empty(), loading: false, blocked: true }; listeners.clear(); },
  };
}
export type RegistrationWorkspaceController = ReturnType<typeof createRegistrationWorkspace>;
