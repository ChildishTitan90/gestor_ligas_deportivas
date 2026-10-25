"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { createReviewApi } from "../affiliation-review-adapter";
import { createReviewController, type ReviewController } from "../affiliation-review-controller";
import { AffiliationReviewList } from "./affiliation-review-list";

const buttonClass = "min-h-12 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold text-primary hover:bg-background disabled:opacity-50";
const historyLabels = {
  AFFILIATION_APPROVE: "Afiliación aprobada",
  AFFILIATION_REQUEST_CORRECTIONS: "Correcciones solicitadas",
  AFFILIATION_RESUBMIT: "Solicitud reenviada",
};
const officeNames = { PRESIDENT: "Presidente", SECRETARY: "Secretario", TREASURER: "Tesorero" };
const historyDate = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City",
});
const errors = {
  unauthenticated: "Tu sesión terminó. Inicia sesión nuevamente para continuar.",
  forbidden: "Acceso denegado. No tienes autorización para esta operación en el ámbito consultado.",
  conflict: "La solicitud ya fue revisada. Consulta su resultado actual.",
  unavailable: "No se pudo cargar el detalle de la solicitud. Intenta consultar nuevamente.",
  "invalid-response": "No se pudo cargar el detalle de la solicitud. Intenta consultar nuevamente.",
};

type LeagueOption = { id: string; name: string };
export function AffiliationReviewWorkspace({ leagues }: { leagues: LeagueOption[] }) {
  const [controller] = useState(() => createReviewController(createReviewApi()));
  return <AffiliationReviewView controller={controller} leagues={leagues} />;
}

/** Las pruebas inyectan su controlador; la página real solo usa el adaptador HTTP. */
export function AffiliationReviewView({ controller, leagues = [] }: { controller: ReviewController; leagues?: LeagueOption[] }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const prefix = useId();
  const observationsRef = useRef<HTMLTextAreaElement>(null);
  const { detail } = state;
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (detail) detailHeading.current?.focus(); }, [detail]);
  useEffect(() => {
    if (!state.download) return;
    const timeout = setTimeout(controller.clearDownload, Math.max(0, state.download.expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [controller, state.download]);
  function query(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const leagueId = String(new FormData(event.currentTarget).get("leagueId") ?? "").trim();
    void controller.load(leagueId);
  }
  function corrections(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state.observations.trim()) observationsRef.current?.focus();
    void controller.submit("REQUEST_CORRECTIONS");
  }
  const busy = state.submitting || state.loading || state.detailLoading || state.downloading;
  const uncertainResult = state.errorContext === "review" && (state.error === "unavailable" || state.error === "invalid-response");
  const errorMessage = uncertainResult ? "No se pudo confirmar el resultado de la revisión. Verifica el estado de la solicitud antes de reenviarla." :
    state.errorContext === "list" && (state.error === "unavailable" || state.error === "invalid-response") ?
      "No se pudieron cargar las solicitudes. Intenta consultar nuevamente." :
      state.errorContext === "download" && (state.error === "unavailable" || state.error === "invalid-response") ?
        "No se pudo obtener el enlace de la firma. Vuelve a consultar la solicitud." : state.error ? errors[state.error] : "";
  const canReview = detail?.status === "PENDING" && !state.error && !busy;
  return <div className="mt-6 space-y-6">
    <form onSubmit={query} className="space-y-3" aria-busy={state.loading}>
      <label htmlFor={`${prefix}-league`} className="block text-sm font-medium">Liga</label>
      <p id={`${prefix}-league-help`} className="text-sm text-muted">Consulta una liga de tu ámbito autorizado.</p>
      <select id={`${prefix}-league`} name="leagueId" required disabled={busy || !leagues.length}
        aria-describedby={`${prefix}-league-help${!detail && state.fieldError ? ` ${prefix}-field-error` : ""}`}
        aria-invalid={!detail && !!state.fieldError}
        className="min-h-12 w-full rounded-xl border border-border bg-surface px-3.5 py-3">
        {leagues.map(league => <option key={league.id} value={league.id}>{league.name}</option>)}
      </select>
      {!leagues.length && <p>No tienes ligas disponibles para consultar esta bandeja.</p>}
      <button type="submit" disabled={busy || !leagues.length} className={buttonClass}>Consultar pendientes</button>
    </form>
    {state.fieldError && <p id={`${prefix}-field-error`} role="alert" className="text-danger">{state.fieldError}</p>}
    {state.message && <p role="status" className="rounded-xl bg-soft p-4">{state.message}</p>}
    {state.error && <div role="alert" className="rounded-xl border border-danger/25 bg-danger-surface p-4 text-danger">
      <p>{errorMessage}</p>
      {state.error === "unauthenticated" ? <ActionLink href="/login" className="mt-3">Iniciar sesión</ActionLink> :
        <button type="button" disabled={busy} onClick={() => void controller.load(state.leagueId)} className={`${buttonClass} mt-3`}>Volver a consultar</button>}
    </div>}
    {state.loading && <p role="status">Cargando solicitudes…</p>}
    {!state.loading && !state.error && state.loaded && <AffiliationReviewList
      disabled={busy} onSelect={id => void controller.open(id)}
      items={state.items.filter(item => item.status === "PENDING" && item.reviewPhase !== null).map(item => ({
        ...item, status: "PENDING" as const, reviewPhase: item.reviewPhase!, detailHref: "#affiliation-detail",
      }))} />}
    {state.detailLoading && <p role="status">Cargando detalle…</p>}
    {detail && <section id="affiliation-detail" aria-labelledby={`${prefix}-detail-title`} aria-busy={state.submitting}
      className="space-y-5 rounded-2xl border border-border bg-background p-5">
      <h2 ref={detailHeading} id={`${prefix}-detail-title`} tabIndex={-1} className="text-xl font-semibold text-primary">{detail.clubName} · {detail.referenceNumber}</h2>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Temporada</dt><dd>{detail.seasonName}</dd></div>
        <div><dt className="text-muted">Estado de aprobación</dt><dd>{{ PENDING: "Pendiente", APPROVED: "Aprobada" }[detail.status]}</dd></div>
        <div><dt className="text-muted">Fase de revisión</dt><dd>{detail.reviewPhase === "AWAITING_REVIEW" ? "Pendiente de revisión" : detail.reviewPhase === "CORRECTIONS_REQUESTED" ? "Correcciones solicitadas" : "No aplica"}</dd></div>
        <div><dt className="text-muted">Colores del uniforme</dt><dd>{detail.uniformColors || "Sin información"}</dd></div>
        <div><dt className="text-muted">Categorías solicitadas</dt><dd>{detail.categories.join(", ") || "Sin categorías informadas"}</dd></div>
        <div><dt className="text-muted">Observaciones registradas</dt><dd className="whitespace-pre-wrap break-words">{detail.observations || "Sin observaciones registradas"}</dd></div>
      </dl>
      <section aria-labelledby={`${prefix}-officers-title`} className="space-y-3">
        <h3 id={`${prefix}-officers-title`} className="font-semibold">Directivos y firmas privadas</h3>
        <ul className="space-y-3">
          {detail.officers.map(officer => <li key={officer.office} className="space-y-2 rounded-xl border border-border p-3 text-sm">
            <p className="font-medium">{officeNames[officer.office]}</p>
            <p>{[officer.firstName, officer.paternalSurname, officer.maternalSurname].filter(Boolean).join(" ")}</p>
            {officer.signatureFileId ? <button type="button" className={buttonClass} disabled={busy || state.confirming || !!state.error}
              onClick={() => void controller.signature(officer.signatureFileId!)}>Consultar firma de {officeNames[officer.office].toLowerCase()}</button> :
              <p>Sin firma registrada.</p>}
            {state.download && state.download.fileId === officer.signatureFileId && <div className="space-y-2">
              <p>Enlace temporal disponible durante un máximo de 60 segundos.</p>
              <a href={state.download.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                className="inline-block rounded-xl border border-border px-4 py-3 font-semibold"
                onClick={event => { if (Date.now() >= state.download!.expiresAt) { event.preventDefault(); controller.clearDownload(); } }}>
                Descargar firma de {officeNames[officer.office].toLowerCase()}
              </a>
            </div>}
          </li>)}
        </ul>
        {state.downloading && <p role="status">Solicitando acceso a la firma…</p>}
      </section>
      <section aria-labelledby={`${prefix}-history-title`} className="space-y-3">
        <h3 id={`${prefix}-history-title`} className="font-semibold">Historial de revisión</h3>
        {detail.history.length === 0 ? <p className="text-sm text-muted">Sin revisiones registradas.</p> : <>
          <p className="text-sm text-muted">Fechas en horario de Ciudad de México, de la más antigua a la más reciente.</p>
          <ol className="space-y-3">
            {detail.history.map(entry => <li key={entry.id} className="rounded-xl border border-border p-3 text-sm">
              <p className="font-medium">{historyLabels[entry.action]}</p>
              <time dateTime={entry.occurredAt} className="text-muted">{historyDate.format(new Date(entry.occurredAt))}</time>
              {entry.observations && <p className="mt-2 whitespace-pre-wrap break-words">{entry.observations}</p>}
            </li>)}
          </ol>
        </>}
      </section>
      {detail.status === "PENDING" && detail.allowedActions.length === 0 && <p>No hay acciones de revisión disponibles para esta solicitud.</p>}
      {detail.status === "PENDING" && <form onSubmit={corrections} className="space-y-4">
        <label htmlFor={`${prefix}-observations`} className="block font-medium">Observaciones (obligatorias para solicitar correcciones)</label>
        <textarea ref={observationsRef} id={`${prefix}-observations`} value={state.observations} maxLength={2000}
          disabled={!canReview} onChange={event => controller.observations(event.target.value)}
          aria-invalid={!!state.fieldError} aria-describedby={state.fieldError ? `${prefix}-field-error` : undefined}
          className="min-h-32 w-full rounded-xl border border-border bg-surface p-3" />
        <div className="flex flex-wrap gap-3">
          {detail.allowedActions.includes("REQUEST_CORRECTIONS") && <button type="submit" disabled={!canReview || state.confirming} className={buttonClass}>Solicitar correcciones</button>}
          {detail.allowedActions.includes("APPROVE") && <button ref={approveButton} type="button" disabled={!canReview || state.confirming} onClick={() => void controller.submit("APPROVE")} className={buttonClass}>Aprobar solicitud</button>}
        </div>
      </form>}
      {state.confirming && <div role="group" aria-labelledby={`${prefix}-confirm`} className="space-y-3 rounded-xl border border-border p-4">
        <p id={`${prefix}-confirm`}>¿Confirmas la aprobación de {detail.clubName}, folio {detail.referenceNumber}?</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" autoFocus disabled={state.submitting} onClick={() => { controller.cancel(); requestAnimationFrame(() => approveButton.current?.focus()); }} className={buttonClass}>Cancelar</button>
          <button type="button" disabled={state.submitting} onClick={() => void controller.confirmApproval()} className={buttonClass}>Confirmar aprobación</button>
        </div>
      </div>}
      {state.submitting && <p role="status">Enviando revisión y consultando el resultado…</p>}
    </section>}
  </div>;
}
