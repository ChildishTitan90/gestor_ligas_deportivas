"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { SelectField } from "@/components/ui/select-field";
import { createEnrollmentApi } from "../team-registration-adapter";
import { createRegistrationWorkspace, type RegistrationWorkspaceController } from "../team-registration-workspace-controller";
import { TeamRegistrationFormView } from "./team-registration-form";
import { TeamRegistrationList } from "./team-registration-list";

export function TeamRegistrationWorkspace({ userId }: { userId: string }) {
  return <IdentityWorkspace key={userId} userId={userId} />;
}

/** Cambiar la clave desmonta solo este límite y destruye el controlador anterior. */
export function IdentityWorkspace({ userId }: { userId: string }) {
  const [controller] = useState(() => createRegistrationWorkspace(createEnrollmentApi(
    (...args) => fetch(...args), {
      getItem: key => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value),
      removeItem: key => sessionStorage.removeItem(key),
    }, `team-enrollment:pending:${userId}`, userId)));
  useEffect(() => { void controller.initialize(); return () => controller.dispose(); }, [controller]);
  return <TeamRegistrationWorkspaceView controller={controller} />;
}
const button = "min-h-12 rounded-xl border border-border px-5 py-3 text-primary disabled:opacity-50";
/** Vista de datos reales; las pruebas inyectan el controlador y una red simulada. */
export function TeamRegistrationWorkspaceView({ controller }: { controller: RegistrationWorkspaceController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.optionsError || state.closeError) noticeRef.current?.focus(); }, [state.optionsError, state.closeError]);
  const queryRequested = useRef(false);
  const queryNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (queryRequested.current && !state.listLoading && (state.listed || state.listError)) {
      queryNotice.current?.focus(); queryRequested.current = false;
    }
  }, [state.listLoading, state.listed, state.listError]);
  const operationNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (state.operationMessage && !state.operationBusy) operationNotice.current?.focus(); }, [state.operationMessage, state.operationBusy]);
  function query(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    queryRequested.current = true;
    const data = new FormData(event.currentTarget);
    void controller.list(String(data.get("clubId") ?? "").trim(), String(data.get("seasonId") ?? "").trim());
  }
  return <div className="mt-6 space-y-6">
    {state.loading && <p role="status">Cargando opciones autorizadas…</p>}
    {state.optionsError && <div ref={noticeRef} tabIndex={-1} role="alert"><p>{state.optionsError}</p>
      <button className={button} type="button" disabled={state.loading} onClick={() => void controller.initialize()}>{state.formClosed ? "Retomar envío pendiente" : "Volver a consultar opciones"}</button>
    </div>}
    <button type="button" className={button} disabled={state.loading || state.blocked || state.formClosed} onClick={() => void controller.reloadOptions()}>Actualizar opciones</button>
    <p className="text-sm text-muted">Las opciones para inscribir y crear equipos dependen de la autorización vigente del club seleccionado.</p>
    {state.formVisible && <TeamRegistrationFormView controller={controller.form} disabled={state.loading || !!state.optionsError || state.operationBusy}
      onContextChange={(clubId, seasonId) => void controller.context(clubId, seasonId)} />}
    {state.formVisible && <PendingOperations controller={controller} />}
    {state.operationBusy && <p role="status">Consultando o cancelando la intención…</p>}
    {state.operationMessage && <p ref={operationNotice} tabIndex={-1} role="status">{state.operationMessage}</p>}
    {state.cancelConfirm && <CancellationDialog controller={controller} />}
    {state.closeConfirm && <ClosePendingDialog controller={controller} />}
    {state.closeError && <p ref={noticeRef} tabIndex={-1} role="alert">{state.closeError}</p>}
    <section aria-labelledby="registration-query-title" className="space-y-4 rounded-3xl border border-border p-5 sm:p-8">
      <h2 id="registration-query-title" className="text-xl font-semibold text-primary">Consultar inscripciones e historial</h2>
      <p className="text-sm text-muted">Selecciona un club autorizado y, si lo necesitas, una temporada. Todas las temporadas incluye el historial cerrado. Un listado vacío no resuelve un envío pendiente.</p>
      {state.catalogLoading && <p role="status">Cargando catálogos autorizados…</p>}
      {state.catalogError && <div role="alert"><p>{state.catalogError}</p><button type="button" className={button} onClick={() => void controller.queryCatalogs()}>Volver a consultar catálogos</button></div>}
      {!state.catalogLoading && !state.catalogError && !state.queryClubs.length && <p>No hay clubes disponibles para consultar en tu ámbito.</p>}
      <form onSubmit={query} className="space-y-4" aria-busy={state.listLoading || state.catalogLoading}>
        <div><label htmlFor="registration-query-club">Club *</label>
          <SelectField id="registration-query-club" name="clubId" value={state.queryClubId} required
            disabled={state.catalogLoading || state.listLoading || !!state.catalogError} className="mt-2"
            placeholder="Selecciona un club" onValueChange={value => void controller.queryCatalogs(value, "")}
            options={state.queryClubs.map(club => ({ value: club.id, label: club.name }))} /></div>
        <div><label htmlFor="registration-query-season">Temporada</label>
          <SelectField id="registration-query-season" name="seasonId" value={state.querySeasonId}
            disabled={state.catalogLoading || state.listLoading || !state.queryClubId || !!state.catalogError} className="mt-2"
            onValueChange={value => void controller.queryCatalogs(state.queryClubId, value)}
            options={[{ value: "", label: "Todas las temporadas" }, ...state.querySeasons.map(season => ({ value: season.id, label: season.name }))]} /></div>
        <button className={button} disabled={state.listLoading || state.catalogLoading || !state.queryClubId || !!state.catalogError}>Consultar inscripciones</button>
      </form>
      {state.listLoading && <p role="status">Cargando inscripciones…</p>}
      {state.listError && <p ref={queryNotice} tabIndex={-1} role="alert">{state.listError}</p>}
      {!state.listLoading && !state.listError && state.listed && <p ref={queryNotice} tabIndex={-1} role="status">{state.items.length} inscripciones cargadas para la consulta seleccionada.</p>}
      {!state.listLoading && !state.listError && state.listed && <TeamRegistrationList items={state.items} />}
      {state.nextAfter && !state.listError && <button type="button" className={button} disabled={state.listLoading}
        onClick={() => { queryRequested.current = true; void controller.list(state.listClubId, state.listSeasonId, true); }}>Cargar más inscripciones</button>}
    </section>
    <nav aria-label="Acceso a la cuenta" className="flex flex-wrap gap-3">
      <ActionLink href="/access" variant="secondary">Mi panel</ActionLink>
      <ActionLink href="/futbol" variant="secondary">Portal de fútbol</ActionLink>
    </nav>
  </div>;
}

function PendingOperations({ controller }: { controller: RegistrationWorkspaceController }) {
  const state = useSyncExternalStore(controller.form.subscribe, controller.form.getSnapshot, controller.form.getSnapshot);
  const workspace = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const disabled = state.submitting || workspace.operationBusy || workspace.loading || workspace.closeBusy;
  return state.outcome === "unconfirmed" || state.pendingCleanup ? <div className="flex flex-wrap gap-3" aria-label="Resolver envío pendiente">
    <button type="button" className={button} disabled={disabled} onClick={() => void controller.checkOperation()}>Consultar resultado del envío</button>
    {state.outcome === "unconfirmed" && <>
      <button type="button" className={button} disabled={disabled} onClick={() => controller.requestCancellation()}>Cancelar intención…</button>
      <button type="button" className={button} disabled={disabled} onClick={() => controller.requestClose()}>Cerrar formulario…</button>
    </>}
  </div> : null;
}

/** El modal nativo mantiene el foco y vuelve inerte el resto de la página. */
function ClosePendingDialog({ controller }: { controller: RegistrationWorkspaceController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    keepRef.current?.focus();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected && !trigger.matches(":disabled")) trigger.focus();
    };
  }, []);
  return <dialog ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="close-pending-title" aria-describedby="close-pending-warning"
    aria-busy={state.closeBusy} onCancel={event => { event.preventDefault(); controller.cancelClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg space-y-3 overflow-y-auto rounded-xl border border-border bg-surface p-5 text-primary backdrop:bg-black/40">
    <h2 id="close-pending-title">¿Cerrar el formulario con un envío pendiente?</h2>
    <p id="close-pending-warning">Cerrar o descartar este formulario solo lo oculta. Conservaremos el cuerpo y la clave del envío pendiente en esta pestaña, también al recargar. No cancela la operación ni confirma su resultado. No podrás iniciar otra inscripción hasta resolverlo.</p>
    <button ref={keepRef} type="button" className={button} disabled={state.closeBusy} onClick={() => controller.cancelClose()}>Seguir en el formulario</button>
    <button type="button" className={button} disabled={state.closeBusy} onClick={() => void controller.confirmClose()}>Cerrar y conservar pendiente</button>
  </dialog>;
}

function CancellationDialog({ controller }: { controller: RegistrationWorkspaceController }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    dialogRef.current?.showModal(); keepRef.current?.focus();
    const dialog = dialogRef.current;
    return () => { dialog?.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="cancel-operation-title" aria-describedby="cancel-operation-warning"
    onCancel={event => { event.preventDefault(); controller.dismissCancellation(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg space-y-3 overflow-y-auto rounded-xl border border-border bg-surface p-5 text-primary backdrop:bg-black/40">
    <h2 id="cancel-operation-title">¿Cancelar la intención de inscripción?</h2>
    <p id="cancel-operation-warning">Esta acción pide al servidor detener la intención. Si la inscripción ya se confirmó, se conservará. Hasta recibir CONFIRMED o CANCELLED mantendremos el cuerpo y la clave. Cerrar el formulario no realiza esta cancelación.</p>
    <button ref={keepRef} type="button" className={button} onClick={() => controller.dismissCancellation()}>Seguir consultando</button>
    <button type="button" className={button} onClick={() => void controller.confirmCancellation()}>Confirmar cancelación de intención</button>
  </dialog>;
}
