"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ActionLink } from "@/components/ui/action-link";
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
const input = "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2";
/** Vista de datos reales; las pruebas inyectan el controlador y una red simulada. */
export function TeamRegistrationWorkspaceView({ controller }: { controller: RegistrationWorkspaceController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state.optionsError || state.closeError) noticeRef.current?.focus(); }, [state.optionsError, state.closeError]);
  function query(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void controller.list(String(data.get("clubId") ?? "").trim(), String(data.get("seasonId") ?? "").trim());
  }
  return <div className="mt-6 space-y-6">
    {state.loading && <p role="status">Cargando opciones autorizadas…</p>}
    {state.optionsError && <div ref={noticeRef} tabIndex={-1} role="alert"><p>{state.optionsError}</p>
      <button className={button} type="button" disabled={state.loading} onClick={() => void controller.initialize()}>{state.formClosed ? "Retomar envío pendiente" : "Volver a consultar opciones"}</button>
    </div>}
    <button type="button" className={button} disabled={state.loading || state.blocked || state.formClosed} onClick={() => void controller.reloadOptions()}>Actualizar opciones</button>
    <p className="text-sm text-muted">Por ahora puedes inscribir equipos existentes disponibles para tu club.</p>
    {state.formVisible && <TeamRegistrationFormView controller={controller.form} disabled={state.loading || !!state.optionsError}
      onContextChange={(clubId, seasonId) => void controller.context(clubId, seasonId)} />}
    {state.formVisible && <ClosePending controller={controller} />}
    {state.closeConfirm && <ClosePendingDialog controller={controller} />}
    {state.closeError && <p ref={noticeRef} tabIndex={-1} role="alert">{state.closeError}</p>}
    <section aria-labelledby="registration-query-title" className="space-y-4 rounded-3xl border border-border p-5 sm:p-8">
      <h2 id="registration-query-title" className="text-xl font-semibold text-primary">Consultar inscripciones e historial</h2>
      <p className="text-sm text-muted">Usa el identificador de un club de tu ámbito. El servidor comprueba el permiso de consulta, también para temporadas cerradas. Deja la temporada vacía para consultar todo el historial.</p>
      <form onSubmit={query} className="space-y-4" aria-busy={state.listLoading}>
        <div><label htmlFor="registration-query-club">Identificador del club *</label>
          <input key={`club-${state.listClubId}`} id="registration-query-club" name="clubId" defaultValue={state.listClubId} required pattern="[0-9a-fA-F-]{36}" disabled={state.listLoading} className={input} /></div>
        <div><label htmlFor="registration-query-season">Identificador de temporada (opcional)</label>
          <input key={`season-${state.listSeasonId}`} id="registration-query-season" name="seasonId" defaultValue={state.listSeasonId} pattern="[0-9a-fA-F-]{36}" disabled={state.listLoading} className={input} /></div>
        <button className={button} disabled={state.listLoading}>Consultar inscripciones</button>
      </form>
      {state.listLoading && <p role="status">Cargando inscripciones…</p>}
      {state.listError && <p role="alert">{state.listError}</p>}
      {!state.listLoading && !state.listError && state.listed && <TeamRegistrationList items={state.items} />}
      {state.nextAfter && !state.listError && <button type="button" className={button} disabled={state.listLoading}
        onClick={() => void controller.list(state.listClubId, state.listSeasonId, true)}>Cargar más inscripciones</button>}
    </section>
    <nav aria-label="Acceso a la cuenta" className="flex flex-wrap gap-3">
      <ActionLink href="/login" variant="secondary">Iniciar sesión</ActionLink>
      <ActionLink href="/change-password" variant="secondary">Cambiar contraseña</ActionLink>
    </nav>
  </div>;
}

function ClosePending({ controller }: { controller: RegistrationWorkspaceController }) {
  const state = useSyncExternalStore(controller.form.subscribe, controller.form.getSnapshot, controller.form.getSnapshot);
  return state.outcome === "unconfirmed" ? <button type="button" className={button} disabled={state.submitting}
    onClick={() => controller.requestClose()}>Cerrar formulario…</button> : null;
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
