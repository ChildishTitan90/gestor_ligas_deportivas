"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createTeamRegistrationFormController, registrationChoices, type TeamRegistrationField, type TeamRegistrationFormController } from "../team-registration-form-controller";
import type { TeamRegistrationFormOptions, TeamRegistrationOption, TeamRegistrationSubmit } from "../team-registration-model";

const controlClass = "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-base focus:border-primary disabled:opacity-50";

export function TeamRegistrationForm({ options, onSubmit }: { options: TeamRegistrationFormOptions; onSubmit: TeamRegistrationSubmit }) {
  const [controller] = useState(() => createTeamRegistrationFormController(options, onSubmit));
  useEffect(() => controller.configure(options, onSubmit), [controller, options, onSubmit]);
  return <TeamRegistrationFormView controller={controller} />;
}

/** Vista inyectable para pruebas; ninguna página monta fixtures. */
export function TeamRegistrationFormView({ controller, disabled = false, onContextChange }: { controller: TeamRegistrationFormController; disabled?: boolean; onContextChange?: (clubId: string, seasonId: string) => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const { draft, options, errors, submitting } = state;
  const locked = disabled || submitting || state.outcome !== "idle";
  const { club, season, category, seasons, teams, categories, groups, hasRequiredOptions } = registrationChoices(options, draft);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const previousOutcome = useRef(state.outcome);
  useEffect(() => {
    if (disabled || submitting) return;
    const firstError = Object.keys(errors)[0];
    const target = firstError ? formRef.current?.elements.namedItem(firstError) : null;
    if (target instanceof HTMLElement) target.focus();
    else if (state.message) messageRef.current?.focus();
    else if (previousOutcome.current === "confirmed" && state.outcome === "idle") {
      const clubControl = formRef.current?.elements.namedItem("clubId");
      if (clubControl instanceof HTMLElement) clubControl.focus();
    }
    previousOutcome.current = state.outcome;
  }, [disabled, submitting, errors, state.message, state.outcome]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    await controller.submit();
  }
  function error(field: TeamRegistrationField) {
    return errors[field] ? <p id={`${prefix}-${field}-error`} className="mt-2 text-sm text-danger">{errors[field]}</p> : null;
  }
  function select(field: Exclude<TeamRegistrationField, "teamName">, label: string,
    items: readonly TeamRegistrationOption[], disabled = false) {
    return <div>
      <label htmlFor={`${prefix}-${field}`} className="text-sm font-medium">{label} *</label>
      <select id={`${prefix}-${field}`} name={field} value={draft[field]} required disabled={disabled || locked}
        onChange={event => {
          controller.change(field, event.target.value);
          if (field === "clubId" || field === "seasonId") { const next = controller.getSnapshot().draft; onContextChange?.(next.clubId, next.seasonId); }
        }} aria-invalid={!!errors[field]}
        aria-describedby={errors[field] ? `${prefix}-${field}-error` : undefined} className={controlClass}>
        <option value="">Selecciona una opción</option>
        {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {error(field)}
    </div>;
  }
  return <form ref={formRef} onSubmit={submit} noValidate aria-busy={submitting} aria-labelledby={`${prefix}-title`}
    className="space-y-6 rounded-3xl border border-border bg-surface p-5 sm:p-8">
    <header>
      <h2 id={`${prefix}-title`} className="text-2xl font-semibold text-primary">Inscribir equipo</h2>
      <p className="mt-2 text-sm text-muted">Selecciona el club, la temporada y el grupo. La inscripción inicial será «Inscrito»; no activa el equipo.</p>
    </header>
    {!options.clubs.length && <p>No hay clubes disponibles para inscribir equipos en tu ámbito.</p>}
    {!!Object.keys(errors).length && <p role="alert" className="text-danger">Revisa los campos señalados.</p>}
    {state.message && <p ref={messageRef} tabIndex={-1} role={state.outcome === "confirmed" ? "status" : "alert"}
      className={state.outcome === "confirmed" ? "text-primary" : "text-danger"}>{state.message}</p>}
    <div className="grid gap-5 sm:grid-cols-2">
      {select("clubId", "Club", options.clubs, !options.clubs.length)}
      {select("seasonId", "Temporada", seasons, !club || !seasons.length)}
      {select("teamMode", "Equipo existente o nuevo", [
        { id: "existing", name: "Seleccionar equipo existente" },
        ...(season?.canCreateTeam ? [{ id: "new", name: "Crear equipo" }] : []),
      ], !season)}
      {draft.teamMode === "new" ? <div>
        <label htmlFor={`${prefix}-teamName`} className="text-sm font-medium">Nombre del equipo *</label>
        <input id={`${prefix}-teamName`} name="teamName" value={draft.teamName} required maxLength={200} disabled={locked}
          onChange={event => controller.change("teamName", event.target.value)} aria-invalid={!!errors.teamName}
          aria-describedby={errors.teamName ? `${prefix}-teamName-error` : undefined} className={controlClass} />
        {error("teamName")}
      </div> : select("teamId", "Equipo", teams, !season || !teams.length)}
      {select("categoryId", "Categoría", categories, !season || !categories.length)}
      {select("groupId", "Grupo", groups, !category || !groups.length)}
    </div>
    {season && draft.teamMode === "existing" && !teams.length && <p className="text-sm text-muted">No hay equipos existentes disponibles para esta selección.</p>}
    {club && !seasons.length && <p className="text-sm text-muted">No hay temporadas disponibles para este club.</p>}
    {season && !categories.length && <p className="text-sm text-muted">No hay categorías disponibles para esta temporada.</p>}
    {season && categories.length > 0 && (category ? !groups.length : !categories.some(item => item.groups.length > 0)) &&
      <p className="text-sm text-muted">No hay grupos disponibles para {category ? "la categoría seleccionada" : "las categorías de esta temporada"}.</p>}
    <button type="submit" disabled={locked || !hasRequiredOptions}
      className="min-h-12 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-surface hover:bg-primary-hover disabled:opacity-50">
      {submitting ? "Enviando inscripción…" : "Inscribir equipo"}
    </button>
    {state.retryAvailable && <button type="button" className={controlClass} disabled={disabled || submitting} onClick={() => void controller.retry()}>Recuperar resultado con el mismo envío</button>}
    {state.outcome === "confirmed" && <button type="button" className={controlClass} onClick={() => { controller.reset(); onContextChange?.("", ""); }}>Iniciar otra inscripción</button>}
    {submitting && <p role="status">Espera mientras se procesa el envío.</p>}
  </form>;
}
