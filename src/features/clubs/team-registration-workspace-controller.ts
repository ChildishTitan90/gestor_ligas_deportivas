import { createTeamRegistrationFormController } from "./team-registration-form-controller";
import { EnrollmentReadError, enrollmentMessage, pendingCapture, registrationOptions, type EnrollmentApi, type EnrollmentOptions } from "./team-registration-adapter";
import type { TeamRegistrationItem } from "./team-registration-model";

export function createRegistrationWorkspace(api: EnrollmentApi) {
  const empty = () => ({ loading: true, optionsError: "", listError: "", listLoading: false, listed: false,
    formVisible: false, blocked: false, formClosed: false, closeConfirm: false, closeBusy: false, closeError: "",
    clubId: "", seasonId: "", listClubId: "", listSeasonId: "", nextAfter: null as string | null,
    items: [] as TeamRegistrationItem[], seasons: [] as EnrollmentOptions["seasons"] });
  let state = empty();
  let optionsAbort: AbortController | undefined;
  let listAbort: AbortController | undefined;
  let active = true;
  let epoch = 0;
  let optionsVersion = 0;
  let listVersion = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const message = (error: unknown) => enrollmentMessage(error instanceof EnrollmentReadError ? error.code : "UNAVAILABLE");
  function cancel() { ++optionsVersion; ++listVersion; optionsAbort?.abort(); listAbort?.abort(); }
  function hide(error: unknown) {
    cancel(); api.stop(); ++epoch; form.conceal();
    publish({ ...empty(), loading: false, blocked: true, optionsError: message(error) });
  }
  const denied = (error: unknown) => error instanceof EnrollmentReadError && [401, 403].includes(error.status);
  const submit: EnrollmentApi["submit"] = async capture => {
    if (!active || !state.formVisible || state.blocked || state.loading || state.formClosed || state.closeBusy)
      return { kind: "unconfirmed", message: "Comprueba sesión y acceso antes de enviar o recuperar la inscripción." };
    const version = epoch;
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
    const version = ++optionsVersion;
    publish({ loading: true, optionsError: "" });
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
      const result = await api.list(clubId, seasonId, after, state.seasons, listAbort.signal);
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
  return {
    form, getSnapshot: () => state,
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
        if (!pending) { form.begin(); await options(); return; }
        optionsAbort = new AbortController();
        // Validar identidad y CREATE/READ en el contexto ANTES de restaurar ningún campo.
        const data = await api.options(pending.clubId, pending.seasonId, optionsAbort.signal);
        if (!active || version !== epoch) return;
        if (!data.clubs.some(club => club.id === pending.clubId)) throw new EnrollmentReadError("FORBIDDEN", 403);
        await api.list(pending.clubId, pending.seasonId, "", data.seasons, optionsAbort.signal);
        if (!active || version !== epoch) return;
        form.configure(registrationOptions(data, pending.clubId, pending.seasonId), submit);
        form.restore(pendingCapture(pending));
        publish({ loading: false, formVisible: true, seasons: data.seasons, clubId: pending.clubId, seasonId: pending.seasonId });
      } catch (error) {
        if (active && version === epoch) hide(error);
      }
    },
    async context(clubId: string, seasonId: string) {
      await options(clubId, seasonId);
      if (active && state.formVisible && state.clubId === clubId && state.seasonId === seasonId && clubId) await list(clubId, seasonId);
    },
    requestClose() {
      if (state.formVisible && !state.closeBusy && !form.getSnapshot().submitting && form.getSnapshot().outcome === "unconfirmed")
        publish({ closeConfirm: true, closeError: "" });
    },
    cancelClose() { if (!state.closeBusy) publish({ closeConfirm: false }); },
    async confirmClose() {
      if (!active || !state.closeConfirm || state.closeBusy || form.getSnapshot().submitting) return;
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
