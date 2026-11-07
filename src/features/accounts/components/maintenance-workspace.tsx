"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { ActionLink } from "@/components/ui/action-link";
import { SelectField } from "@/components/ui/select-field";
import { createMaintenanceApi } from "../maintenance-api.client";
import { createMaintenanceController, type MaintenanceController } from "../maintenance-controller";
import { deliveryMessage, emailChangeMessage, type MaintenanceOperation, type MaintenancePage } from "../maintenance-ui";

const button = "min-h-12 rounded-xl border border-border bg-surface px-4 py-3 font-semibold text-primary disabled:opacity-50";
const field = "mt-1 min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground disabled:opacity-60";
type Props = { list: MaintenancePage; actorId: string; canUpdate: boolean; search?: string };

export function AccountMaintenanceWorkspace(props: Props) {
  const router = useRouter();
  const [controller] = useState(() => createMaintenanceController(createMaintenanceApi(), {
    actorId: props.actorId, canUpdate: props.canUpdate, uuid: () => crypto.randomUUID(),
    online: () => navigator.onLine, onSaved: () => router.refresh(),
  }));
  // Ignore late reads/writes after leaving the page; do not replay an operation.
  useEffect(() => { controller.start(); return () => controller.dispose(); }, [controller]);
  return <AccountMaintenanceWorkspaceView {...props} controller={controller} />;
}

export function AccountMaintenanceWorkspaceView({ list, canUpdate, controller, search = "" }: Props & { controller: MaintenanceController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [mode, setMode] = useState<"detail" | MaintenanceOperation>("detail");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const id = useId();
  const detail = state.detail, account = detail?.account;
  const locked = state.busy || state.uncertain || state.reviewRequired;
  const href = (page: number) => `/accounts?${new URLSearchParams({ search, page: String(page), pageSize: String(list.pageSize) })}`;
  useEffect(() => {
    if (!state.uncertain || state.visible) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.uncertain, state.visible]);
  function edit(operation: MaintenanceOperation) {
    setMode(operation); setValue(operation === "username" ? account?.username ?? "" : ""); setReason(""); setConfirmed(false);
  }
  if (state.blocked) return <section role="alert" className="rounded-2xl border border-border bg-surface p-5">
    {state.notice && <p>{state.notice}</p>}<p>{state.error || "La sesión ya no está disponible para consultar esta página."}</p>
    <ActionLink href={state.blocked === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : state.blocked === "FORBIDDEN" ? "/access" : "/login"} className="mt-4">
      {state.blocked === "PASSWORD_CHANGE_REQUIRED" ? "Cambiar contraseña" : state.blocked === "FORBIDDEN" ? "Volver al panel" : "Iniciar sesión"}
    </ActionLink>
  </section>;
  return <>
    <form action="/accounts" className="my-6 rounded-2xl border border-border bg-surface p-5">
      <fieldset disabled={state.busy || state.uncertain} className="grid gap-4 sm:grid-cols-[1fr_12rem_auto]">
        <legend className="sr-only">Buscar cuentas</legend>
        <label htmlFor={`${id}-search`}>Buscar por nombre de usuario<input id={`${id}-search`} name="search" defaultValue={search} maxLength={100} className={field} /></label>
        <div><label htmlFor={`${id}-size`}>Resultados por página</label><SelectField id={`${id}-size`} name="pageSize" defaultValue={String(list.pageSize)} searchable={false}
          options={[...new Set([list.pageSize, 20, 50])].map(size => ({ value: String(size), label: `${size} cuentas` }))} /></div>
        <button type="submit" className="primary-action min-h-12 self-end rounded-xl px-5 py-3 font-semibold">Buscar</button>
      </fieldset>
    </form>
    {state.notice && <p role="status" className="my-4 text-primary">{state.notice}</p>}
    {state.uncertain && !state.visible && <aside className="my-4 rounded-xl border border-border bg-surface p-4">
      <p>Hay una operación sin resultado comprobado. No inicies otra ni recargues antes de consultarla.</p>
      <button type="button" className={button} onClick={() => controller.reopen()}>Reabrir operación pendiente</button>
    </aside>}
    {!canUpdate && <p className="mb-4 text-muted">Tu permiso permite consultar el estado de las cuentas. Los identificadores privados y las acciones de edición no están disponibles.</p>}
    {!list.items.length ? <p className="rounded-2xl border border-border bg-surface p-6">No hay cuentas para esta búsqueda.</p> : <ul className="grid gap-4 sm:grid-cols-2">
      {list.items.map(row => <li key={row.id} className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="break-all text-lg font-semibold text-primary">@{row.username}</h2>
        <p className="my-3">{row.isActive ? "Activa" : "Inactiva"}</p>
        <button type="button" className={button} disabled={state.busy || state.uncertain}
          onClick={() => { setMode("detail"); setReason(""); setConfirmed(false); void controller.open(row.id); }}>Ver detalle de @{row.username}</button>
      </li>)}
    </ul>}
    <nav aria-label="Paginación de cuentas" className="mt-6 flex flex-wrap items-center gap-4">
      <p>{list.total} resultados · Página {list.page}</p>
      {!state.busy && !state.uncertain && <>
        {list.page > 1 && <ActionLink href={href(list.page - 1)} variant="secondary">Página anterior</ActionLink>}
        {list.page * list.pageSize < list.total && <ActionLink href={href(list.page + 1)} variant="secondary">Página siguiente</ActionLink>}
        {list.page > 1 && <ActionLink href={href(1)} variant="secondary">Volver al inicio</ActionLink>}
      </>}
    </nav>
    <FormDialog open={state.visible} title={mode === "detail" ? "Detalle de cuenta" : mode === "username" ? "Editar nombre de usuario" : mode === "email" ? "Solicitar cambio de correo" : account?.isActive ? "Confirmar baja de cuenta" : "Confirmar reactivación"}
      description={account ? `Cuenta @${account.username}` : "Consulta autorizada de cuenta"} pending={state.busy} uncertain={state.uncertain}
      dirty={mode !== "detail" && !state.notice && (!!reason || confirmed || value !== (mode === "username" ? account?.username ?? "" : ""))} onClose={() => controller.close()}>
      {state.busy && !detail && <p role="status">Consultando datos actuales…</p>}
      {state.error && <p id={`${id}-error`} role="alert" className="mb-4">{state.error}</p>}
      {state.notice && <p role="status" className="mb-4">{state.notice}</p>}
      {!detail && !state.busy && state.targetId && <button type="button" className={button} onClick={() => void controller.open(state.targetId)}>Volver a consultar</button>}
      {detail && <div className="space-y-5">
        <dl className="space-y-2"><dt className="font-semibold">Nombre de usuario</dt><dd className="break-all">@{detail.account.username}</dd>
          <dt className="font-semibold">Estado de acceso</dt><dd>{detail.account.isActive ? "Activa" : "Inactiva"}</dd>
          {canUpdate && detail.identifiers && <><dt className="font-semibold">Correo de acceso consultado</dt><dd className="break-all">{detail.identifiers.email}</dd></>}
        </dl>
        {state.email && <section aria-label="Último estado de la solicitud consultada" className="space-y-2 rounded-xl border border-border p-4">
          <h3 className="font-semibold text-primary">Solicitud de cambio de correo</h3><p>{emailChangeMessage(state.email)}</p>
          <p>Vencimiento: <time dateTime={state.email.expiresAt}>{new Date(state.email.expiresAt).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</time></p>
          <p>Confirmación al nuevo correo: {deliveryMessage(state.email.confirmationDelivery)}</p>
          <p>Aviso al correo anterior: {deliveryMessage(state.email.previousNoticeDelivery)}</p>
          {state.email.status === "CONFIRMED" && <p>Aviso de finalización: {deliveryMessage(state.email.completionNoticeDelivery)}</p>}
          <button type="button" className={button} disabled={state.busy || state.uncertain} onClick={() => void controller.pollEmail()}>Consultar solicitud sin reenviar</button>
        </section>}
        {state.uncertain ? <section role="alert" className="space-y-3">
          <p>No se conoce el resultado. La captura permanece solo en esta página; no es un borrador guardado y se pierde al salir o recargar.</p>
          <button type="button" className={button} disabled={state.busy} onClick={() => { setMode("detail"); void controller.refresh(); }}>Consultar estado sin reenviar</button>
          {state.pending?.kind === "email" && <button type="button" className={button} disabled={state.busy} onClick={() => void controller.retryEmail()}>Reintentar la misma solicitud de correo</button>}
        </section> : state.reviewRequired ? <section className="space-y-3">
          <p>Antes de otra operación, consulta y revisa los datos actuales. La confirmación anterior no se reutilizará.</p>
          <button type="button" className={button} disabled={state.busy} onClick={() => { setMode("detail"); setConfirmed(false); void controller.refresh(); }}>Revisar versión actual</button>
        </section> : mode === "detail" ? canUpdate && detail.identifiers && <div className="flex flex-wrap gap-3">
          <button type="button" className={button} onClick={() => edit("username")}>Editar username</button>
          <button type="button" className={button} disabled={!account?.isActive} onClick={() => edit("email")}>Solicitar cambio de correo</button>
          <button type="button" className={button} onClick={() => edit("status")}>{account?.isActive ? "Dar de baja" : "Reactivar cuenta"}</button>
        </div> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void controller.submit(mode, { value, reason, confirmed }); }}>
          <p id={`${id}-effects`}>{mode === "email"
            ? "El nuevo correo quedará pendiente hasta comprobar su propiedad. El correo anterior conserva el login; no se entregan tokens ni contraseñas desde esta pantalla. Una nueva solicitud aceptada reemplaza la anterior."
            : mode === "username" ? "Este cambio revoca las sesiones anteriores de la cuenta y puede invalidar solicitudes de correo pendientes."
            : account?.isActive ? "La cuenta perderá el acceso y sus sesiones se revocarán. Se conservan la persona, roles, asignaciones e historial. Puede invalidar solicitudes de correo pendientes."
            : "La cuenta recuperará el acceso sujeto a sus permisos vigentes. Ninguna sesión anterior se reactivará."}</p>
          {mode !== "status" && <label htmlFor={`${id}-value`} className="block">{mode === "email" ? "Nuevo correo pendiente" : "Nuevo nombre de usuario"}
            <input id={`${id}-value`} name="value" type={mode === "email" ? "email" : "text"} autoComplete="off" value={value} required
              maxLength={mode === "email" ? 254 : 64} pattern={mode === "username" ? "[A-Za-z0-9._-]+" : undefined} disabled={locked}
              aria-describedby={`${id}-effects${mode === "username" ? ` ${id}-username-help` : ""}${state.error ? ` ${id}-error` : ""}`} className={field} onChange={event => setValue(event.target.value)} /></label>}
          {mode === "username" && <p id={`${id}-username-help`} className="text-sm text-muted">Usa de 1 a 64 letras sin acentos, números, punto, guion o guion bajo. Se guardará en minúsculas.</p>}
          <label htmlFor={`${id}-reason`} className="block">Motivo, sin datos sensibles (10 a 300 caracteres)
            <textarea id={`${id}-reason`} name="reason" minLength={10} maxLength={300} required value={reason} disabled={locked}
              aria-describedby={state.error ? `${id}-error` : undefined} className={field} onChange={event => setReason(event.target.value)} /></label>
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="confirmed" required checked={confirmed} disabled={locked} aria-describedby={state.error ? `${id}-error` : undefined} onChange={event => setConfirmed(event.target.checked)} />Confirmo la operación sobre @{account?.username} y sus efectos.</label>
          <button type="submit" className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50" disabled={locked}>{state.busy ? "Esperando respuesta…" : mode === "email" ? "Confirmar solicitud" : "Confirmar y guardar"}</button>
          <button type="button" className={button} disabled={locked} onClick={() => setMode("detail")}>Volver al detalle</button>
        </form>}
      </div>}
    </FormDialog>
  </>;
}
