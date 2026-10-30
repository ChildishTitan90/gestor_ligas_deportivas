"use client";

import { FormDialog } from "@/components/ui/form-dialog";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { createReviewApi } from "../affiliation-review-adapter";
import { createReviewController, type ReviewController } from "../affiliation-review-controller";
import { AffiliationReviewList } from "./affiliation-review-list";
import { AffiliationReviewFilters } from "./affiliation-review-filters";
import { emptyReviewFilters, filterReviewItems, type ReviewFilters } from "../affiliation-review-filters";

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
  const [filters, setFilters] = useState<ReviewFilters>({ ...emptyReviewFilters });
  const [reviewDialog, setReviewDialog] = useState<"corrections" | "approval" | null>(null);
  const observationsRef = useRef<HTMLTextAreaElement>(null);
  const { detail } = state;
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const firstCategory = useRef<HTMLInputElement>(null);
  useEffect(() => { if (detail) detailHeading.current?.focus(); }, [detail]);
  useEffect(() => { if (state.categoryError) firstCategory.current?.focus(); }, [state.categoryError]);
  useEffect(() => {
    if (!state.pendingReview) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.pendingReview]);
  useEffect(() => {
    if (!state.download) return;
    const timeout = setTimeout(controller.clearDownload, Math.max(0, state.download.expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [controller, state.download]);
  async function corrections(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state.observations.trim()) observationsRef.current?.focus();
    await controller.submit("REQUEST_CORRECTIONS");
    const next = controller.getSnapshot();
    if (!next.pendingReview && next.message && next.detail) setReviewDialog(null);
  }
  const busy = state.submitting || state.loading || state.detailLoading || state.downloading;
  const uncertainResult = !!state.pendingReview && !state.submitting;
  const errorMessage = uncertainResult ? "No se pudo confirmar el resultado de la revisión. Verifica el estado de la solicitud antes de reenviarla." :
    state.errorContext === "list" && (state.error === "unavailable" || state.error === "invalid-response") ?
      "No se pudieron cargar las solicitudes. Intenta consultar nuevamente." :
      state.errorContext === "download" && (state.error === "unavailable" || state.error === "invalid-response") ?
        "No se pudo obtener el enlace de la firma. Vuelve a consultar la solicitud." : state.error ? errors[state.error] : "";
  const canReview = detail?.status === "PENDING" && !state.error && !busy;
  const results = filterReviewItems(state.items, filters);
  const approving = reviewDialog === "approval" || state.confirming;
  async function resolvePending(retry = false) {
    if (retry) await controller.retryReview(); else await controller.reconcile();
    if (!controller.getSnapshot().pendingReview) setReviewDialog(null);
  }
  return <div className="mt-6 space-y-6">
    <AffiliationReviewFilters leagues={leagues} items={state.items} sourceLeague={state.leagueId} sourceStatus={state.status} busy={busy || !!state.pendingReview} onQuery={(league, status, nextFilters) => {
      setFilters(nextFilters); void controller.load(league, status);
    }} />
    {state.fieldError && <p id={`${prefix}-field-error`} role="alert" className="text-danger">{state.fieldError}</p>}
    {state.message && <p role="status" className="rounded-xl bg-soft p-4">{state.message}</p>}
    {state.error && <div role="alert" className="rounded-xl border border-danger/25 bg-danger-surface p-4 text-danger">
      <p>{errorMessage}</p>
      {state.error === "unauthenticated" ? <ActionLink href="/login" className="mt-3">Iniciar sesión</ActionLink> : state.pendingReview ?
        <div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void resolvePending()} className={buttonClass}>Consultar resultado sin reenviar</button>
          <button type="button" disabled={busy} onClick={() => setReviewDialog(state.pendingReview?.action === "APPROVE" ? "approval" : "corrections")} className={buttonClass}>Ver envío pendiente</button></div> :
        <button type="button" disabled={busy} onClick={() => void controller.load(state.leagueId, state.status)} className={`${buttonClass} mt-3`}>Volver a consultar</button>}
    </div>}
    {state.loading && <p role="status">Cargando solicitudes…</p>}
    {!state.loading && !state.error && state.loaded && <section aria-label="Resultados de afiliaciones" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-primary">{state.status === "APPROVED" ? "Afiliaciones aprobadas" : "Solicitudes pendientes"}</h2>
        <p role="status" className="text-sm text-muted">{results.total} {results.total === 1 ? "resultado" : "resultados"} en esta consulta</p></div>
      <AffiliationReviewList disabled={busy || !!state.pendingReview} status={state.status} onSelect={id => void controller.open(id)}
      items={results.items.map(item => ({
        ...item, detailHref: "#affiliation-detail",
      }))} />
      <nav aria-label="Páginas de solicitudes" className="flex items-center justify-between gap-3">
        <button type="button" className={buttonClass} disabled={results.page <= 1 || busy} onClick={() => setFilters(previous => ({ ...previous, page: results.page - 1 }))}>Anterior</button>
        <p className="text-sm text-muted">{results.page} / {results.pages}</p>
        <button type="button" className={buttonClass} disabled={results.page >= results.pages || busy} onClick={() => setFilters(previous => ({ ...previous, page: results.page + 1 }))}>Siguiente</button>
      </nav>
    </section>}
    {state.detailLoading && <p role="status">Cargando detalle…</p>}
    {detail && <section id="affiliation-detail" aria-labelledby={`${prefix}-detail-title`} aria-busy={state.submitting}
      className="space-y-5 rounded-3xl border border-border bg-surface p-5 sm:p-7">
      <h2 ref={detailHeading} id={`${prefix}-detail-title`} tabIndex={-1} className="text-xl font-semibold text-primary">{detail.clubName} · {detail.referenceNumber}</h2>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Temporada</dt><dd>{detail.seasonName}</dd></div>
        <div><dt className="text-muted">Estado de aprobación</dt><dd>{{ PENDING: "Pendiente", APPROVED: "Aprobada" }[detail.status]}</dd></div>
        <div><dt className="text-muted">Fase de revisión</dt><dd>{detail.reviewPhase === "AWAITING_REVIEW" ? "Pendiente de revisión" : detail.reviewPhase === "CORRECTIONS_REQUESTED" ? "Correcciones solicitadas" : "No aplica"}</dd></div>
        <div><dt className="text-muted">Colores del uniforme</dt><dd>{detail.uniformColors || "Sin información"}</dd></div>
        <div><dt className="text-muted">Categorías solicitadas</dt><dd>{detail.categories.join(", ") || "Sin categorías informadas"}</dd></div>
        {detail.status === "APPROVED" && <div><dt className="text-muted">Categorías autorizadas</dt>
          <dd>{detail.categoryOptions.filter(c => c.authorized).map(c => c.name).join(", ") || "Sin categorías autorizadas"}</dd></div>}
        <div><dt className="text-muted">Observaciones registradas</dt><dd className="whitespace-pre-wrap wrap-break-word">{detail.observations || "Sin observaciones registradas"}</dd></div>
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
              {entry.observations && <p className="mt-2 whitespace-pre-wrap wrap-break-word">{entry.observations}</p>}
            </li>)}
          </ol>
        </>}
      </section>
      {detail.status === "PENDING" && detail.allowedActions.length === 0 && <p>No hay acciones de revisión disponibles para esta solicitud.</p>}
      {detail.status === "PENDING" && <div className="space-y-4">
        {detail.allowedActions.includes("APPROVE") && <fieldset disabled={!canReview || state.confirming} className="space-y-3">
          <legend className="font-medium">Categorías que autorizas</legend>
          <p id={`${prefix}-categories-help`} className="text-sm text-muted">Selecciona al menos una categoría solicitada. Solo las seleccionadas permitirán inscribir equipos; las demás conservarán su solicitud sin autorización.</p>
          {detail.categoryOptions.map((category, index) => <label key={category.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-border p-3">
            <input ref={index === 0 ? firstCategory : undefined} type="checkbox" checked={state.selectedCategoryIds.includes(category.id)}
              onChange={event => controller.category(category.id, event.target.checked)}
              aria-invalid={!!state.categoryError} aria-describedby={`${prefix}-categories-help${state.categoryError ? ` ${prefix}-categories-error` : ""}`} className="size-5 shrink-0 accent-primary" />
            <span className="wrap-break-word">{category.name}</span>
          </label>)}
          {state.categoryError && <p id={`${prefix}-categories-error`} role="alert" className="text-danger">{state.categoryError}</p>}
        </fieldset>}
        <div className="flex flex-wrap gap-3">
          {detail.allowedActions.includes("REQUEST_CORRECTIONS") && <button type="button" disabled={!canReview || state.confirming} onClick={() => setReviewDialog("corrections")} className={buttonClass}>Solicitar correcciones</button>}
          {detail.allowedActions.includes("APPROVE") && <button ref={approveButton} type="button" disabled={!canReview || state.confirming} onClick={async () => {
            await controller.submit("APPROVE"); if (controller.getSnapshot().confirming) setReviewDialog("approval");
          }} className="primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50">Aprobar solicitud</button>}
        </div>
      </div>}
      {detail.status === "PENDING" && (reviewDialog !== null || state.confirming) && <FormDialog
        open={reviewDialog !== null || state.confirming} title={approving ? "Confirmar aprobación" : "Solicitar correcciones"}
        description={`${detail.clubName} · Folio ${detail.referenceNumber}`}
        initialFocusRef={approving ? undefined : observationsRef} pending={state.submitting} uncertain={uncertainResult}
        dirty={!approving && state.observations.length > 0} onClose={reason => {
          if (reason === "discard") controller.observations("");
          controller.cancel(); setReviewDialog(null);
        }} footer={uncertainResult ? <button type="button" className={buttonClass} disabled={busy} onClick={() => void resolvePending()}>Consultar resultado sin reenviar</button> :
          approving ? <button type="button" disabled={!state.confirming || busy} className="primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50" onClick={async () => {
            await controller.confirmApproval(); const next = controller.getSnapshot(); if (!next.pendingReview && next.message) setReviewDialog(null);
          }}>Confirmar aprobación</button> : <button type="submit" form={`${prefix}-corrections-form`} disabled={busy || !!state.error}
            className="primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50">Enviar correcciones</button>}>
        {approving ? <div className="space-y-4 text-sm leading-7">
          <p>¿Confirmas la aprobación de {detail.clubName}, folio {detail.referenceNumber}?</p>
          <p>Se autorizarán estas categorías: {detail.categoryOptions.filter(c => state.selectedCategoryIds.includes(c.id)).map(c => c.name).join(", ")}.</p>
        </div> : <form id={`${prefix}-corrections-form`} onSubmit={corrections} className="space-y-4">
          <p className="text-sm leading-6 text-muted">Indica qué debe corregir el club. La solicitud seguirá pendiente hasta que reenvíe sus datos.</p>
          <label htmlFor={`${prefix}-observations`} className="block text-sm font-semibold">Observaciones *</label>
          <textarea ref={observationsRef} id={`${prefix}-observations`} name="observations" value={state.observations} maxLength={2000}
            disabled={busy || uncertainResult || !!state.error} onChange={event => controller.observations(event.target.value)}
            aria-invalid={!!state.fieldError} aria-describedby={state.fieldError ? `${prefix}-modal-error` : undefined}
            className="min-h-40 w-full rounded-xl border border-border bg-surface p-3 text-base disabled:opacity-70" />
          {state.fieldError && <p id={`${prefix}-modal-error`} role="alert" className="text-sm text-danger">{state.fieldError}</p>}
          <p className="text-xs text-muted">{state.observations.length} / 2000 caracteres</p>
        </form>}
        {state.error && <div role="alert" className="mt-5 rounded-xl border border-border bg-background p-4 text-sm leading-6"><p>{errorMessage}</p>
          {uncertainResult && <button type="button" disabled={busy} onClick={() => void resolvePending(true)} className={`${buttonClass} mt-3`}>Reintentar exactamente el mismo envío</button>}</div>}
        {uncertainResult && state.message && <p role="status" className="mt-4 text-sm leading-6 text-muted">{state.message}</p>}
      </FormDialog>}
      {state.submitting && <p role="status">Enviando revisión y consultando el resultado…</p>}
    </section>}
  </div>;
}
