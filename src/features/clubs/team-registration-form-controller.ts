import type { TeamRegistrationField, TeamRegistrationFormOptions, TeamRegistrationSubmission, TeamRegistrationSubmit } from "./team-registration-model";

export type TeamRegistrationDraft = {
  clubId: string; seasonId: string; teamMode: "existing" | "new";
  teamId: string; teamName: string; categoryId: string; groupId: string;
};
export type { TeamRegistrationField } from "./team-registration-model";
export type TeamRegistrationErrors = Partial<Record<TeamRegistrationField, string>>;
const emptyDraft = (): TeamRegistrationDraft => ({ clubId: "", seasonId: "", teamMode: "existing", teamId: "", teamName: "", categoryId: "", groupId: "" });

export function registrationChoices(options: TeamRegistrationFormOptions, draft: TeamRegistrationDraft) {
  const club = options.clubs.find(item => item.id === draft.clubId);
  const season = club?.seasons.find(item => item.id === draft.seasonId);
  const category = season?.categories.find(item => item.id === draft.categoryId);
  return { club, season, category, seasons: club?.seasons ?? [], teams: season?.teams ?? [],
    categories: season?.categories ?? [], groups: category?.groups ?? [],
    hasRequiredOptions: !!season && !!season.categories.length &&
      (category ? category.groups.length > 0 : season.categories.some(item => item.groups.length > 0)) &&
      (draft.teamMode === "new" ? season.canCreateTeam : season.teams.length > 0) };
}
function reconcile(options: TeamRegistrationFormOptions, draft: TeamRegistrationDraft): TeamRegistrationDraft {
  const { club, season, category } = registrationChoices(options, draft);
  if (!club) return emptyDraft();
  if (!season) return { ...emptyDraft(), clubId: club.id };
  const mode = draft.teamMode === "new" && season.canCreateTeam ? "new" : "existing";
  return { ...draft, teamMode: mode,
    teamName: mode === "new" ? draft.teamName : "",
    teamId: mode === "existing" && season.teams.some(item => item.id === draft.teamId) ? draft.teamId : "",
    categoryId: category?.id ?? "",
    groupId: category?.groups.some(item => item.id === draft.groupId) ? draft.groupId : "" };
}

export function createTeamRegistrationFormController(initialOptions: TeamRegistrationFormOptions, initialSubmit: TeamRegistrationSubmit) {
  let options = initialOptions;
  let onSubmit = initialSubmit;
  let state = { options, draft: emptyDraft(), errors: {} as TeamRegistrationErrors, submitting: false,
    outcome: "idle" as "idle" | "confirmed" | "unconfirmed", message: "" };
  const listeners = new Set<() => void>();
  function publish(patch: Partial<typeof state>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
  function change(field: TeamRegistrationField, value: string) {
    if (state.submitting || state.outcome !== "idle") return;
    let draft = { ...state.draft, [field]: value };
    if (field === "clubId") draft = { ...emptyDraft(), clubId: value };
    if (field === "seasonId") draft = { ...emptyDraft(), clubId: draft.clubId, seasonId: value };
    if (field === "teamMode") draft = { ...draft, teamId: "", teamName: "", categoryId: "", groupId: "" };
    if (field === "teamId") draft = { ...draft, categoryId: "", groupId: "" };
    if (field === "categoryId") draft.groupId = "";
    publish({ draft: reconcile(options, draft), errors: {}, message: "" });
  }
  async function submit() {
    if (state.submitting || state.outcome !== "idle") return;
    const draft = state.draft;
    const { club, season, category, groups, teams } = registrationChoices(options, draft);
    const errors: TeamRegistrationErrors = {};
    if (!club) errors.clubId = "Selecciona un club disponible.";
    if (!season) errors.seasonId = "Selecciona una temporada disponible para el club.";
    if (draft.teamMode === "new") {
      if (!season?.canCreateTeam) errors.teamMode = "La creación de equipos no está disponible en este ámbito.";
      if (!draft.teamName.trim()) errors.teamName = "Escribe el nombre del equipo.";
    } else if (!teams.some(item => item.id === draft.teamId)) errors.teamId = "Selecciona un equipo disponible.";
    if (!category) errors.categoryId = "Selecciona una categoría disponible para la temporada.";
    if (!groups.some(item => item.id === draft.groupId)) errors.groupId = "Selecciona un grupo de la categoría elegida.";
    publish({ errors, message: "" });
    if (Object.keys(errors).length) return;
    const capture: TeamRegistrationSubmission = {
      clubId: draft.clubId, seasonId: draft.seasonId, categoryId: draft.categoryId, groupId: draft.groupId,
      team: draft.teamMode === "new" ? { kind: "new", name: draft.teamName.trim() } : { kind: "existing", id: draft.teamId },
    };
    publish({ submitting: true });
    function unconfirmed() {
      publish({ outcome: "unconfirmed", message: "No se pudo confirmar la inscripción. El envío está bloqueado: verifica su estado antes de volver a enviarla." });
    }
    try {
      const result = await onSubmit(capture);
      if (result?.kind === "confirmed" && result.status === "REGISTERED" &&
        typeof result.teamId === "string" && result.teamId.trim() &&
        typeof result.seasonTeamId === "string" && result.seasonTeamId.trim() &&
        (capture.team.kind === "new" || result.teamId === capture.team.id)) {
        publish({ outcome: "confirmed", message: "Inscripción confirmada como «Inscrito»." });
      } else if (result?.kind === "correctable") {
        publish({ options, draft: reconcile(options, state.draft), errors: result.fieldErrors ?? {},
          message: "La inscripción no se creó. Revisa los datos y corrige los campos señalados antes de intentar nuevamente." });
      } else { unconfirmed(); }
    } catch { unconfirmed(); }
    finally { publish({ submitting: false }); }
  }
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    configure(nextOptions: TeamRegistrationFormOptions, nextSubmit: TeamRegistrationSubmit) {
      onSubmit = nextSubmit;
      if (options !== nextOptions) {
        options = nextOptions;
        // No borrar captura ni desbloquear por un simple refresco de props/opciones.
        if (!state.submitting && state.outcome === "idle") {
          publish({ options, draft: reconcile(options, state.draft), errors: {}, message: "" });
        }
      }
    },
    change, submit,
  };
}
export type TeamRegistrationFormController = ReturnType<typeof createTeamRegistrationFormController>;
