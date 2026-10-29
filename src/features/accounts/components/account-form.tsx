"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { accountRoleCodes } from "../schemas";
import { parseAccountForm } from "../form-input";
import { accountErrorMessage, accountValidationErrors } from "../form-feedback";
import type { AccountCreationOptions, AccountFormData } from "../types";

const control = "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-base focus:border-primary";

export function AccountForm({ options: initial, canReusePerson, createClubLeagues }: AccountFormData) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const lock = useRef(false);
  const optionRequest = useRef(0);
  const [options, setOptions] = useState(initial);
  const [league, setLeague] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [personMode, setPersonMode] = useState("new");
  const [clubMode, setClubMode] = useState("existing");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [sessionCode, setSessionCode] = useState("");
  const global = roles.includes("SUPERADMIN");
  const delegate = roles.includes("CLUB_DELEGATE");

  async function loadLeague(value: string) {
    const request = ++optionRequest.current;
    setLeague(value);
    setRoles([]);
    setClubMode("existing");
    setOptions({ ...initial, roles: [], clubs: [] });
    setLoading(true);
    setMessage("");
    setErrors({});
    try {
      const response = await fetch(`/api/accounts${value ? `?leagueId=${encodeURIComponent(value)}` : ""}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (request !== optionRequest.current) return;
      if (!response.ok) {
        setMessage(accountErrorMessage(data.code));
        setSessionCode(data.code);
        return;
      }
      setOptions(data as AccountCreationOptions);
    } catch {
      if (request === optionRequest.current) setMessage("No se pudieron cargar las opciones. Vuelve a seleccionar la liga.");
    } finally { if (request === optionRequest.current) setLoading(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || loading || uncertain || success) return;
    const values = new FormData(event.currentTarget);
    const parsed = parseAccountForm(values, roles, league, personMode, clubMode);
    setMessage("");
    setErrors({});
    if (!parsed.success) {
      const next = accountValidationErrors(parsed.error.issues);
      setErrors(next);
      setMessage("Revisa los campos señalados.");
      const target = form.current?.elements.namedItem(Object.keys(next)[0]);
      if (target instanceof HTMLElement) target.focus();
      else form.current?.querySelector<HTMLElement>("[aria-invalid='true'], input, select")?.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/accounts", { method: "POST", signal: AbortSignal.timeout(30_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (response.status === 201 && typeof result.id === "string" && result.mustChangePassword === true) {
        form.current?.reset();
        setSuccess(true);
      } else {
        setMessage(accountErrorMessage(result.code));
        setSessionCode(result.code);
        if (response.status >= 500 || response.ok) setUncertain(true);
      }
    } catch {
      setMessage(accountErrorMessage("UNCONFIRMED"));
      setUncertain(true);
    } finally {
      const password = form.current?.elements.namedItem("temporaryPassword");
      if (password instanceof HTMLInputElement) password.value = "";
      lock.current = false;
      setBusy(false);
    }
  }

  function feedback(path: string) {
    return errors[path] ? <p id={`${id}-${path}-error`} className="mt-2 text-sm text-danger">{errors[path]}</p> : null;
  }
  function field(path: string, label: string, maxLength: number, type = "text", required = true) {
    return <div><label htmlFor={`${id}-${path}`} className="text-sm font-medium">{label}{required ? " *" : ""}</label>
      <input id={`${id}-${path}`} name={path} type={type} maxLength={maxLength} required={required}
        autoComplete={type === "password" ? "new-password" : "off"} className={control}
        aria-invalid={Boolean(errors[path])} aria-describedby={errors[path] ? `${id}-${path}-error` : undefined} />{feedback(path)}</div>;
  }
  function select(path: string, label: string, children: React.ReactNode, value?: string, onChange?: (value: string) => void) {
    return <div><label htmlFor={`${id}-${path}`} className="text-sm font-medium">{label} *</label>
      <select key={path === "club.id" ? league : path} id={`${id}-${path}`} name={path} required className={control}
        value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        aria-invalid={Boolean(errors[path])} aria-describedby={errors[path] ? `${id}-${path}-error` : undefined}>
        {children}</select>{feedback(path)}</div>;
  }

  if (success) return <div className="mt-6 space-y-5">
    <p role="status" className="rounded-xl bg-soft p-4">Cuenta creada. La persona deberá cambiar su contraseña temporal al iniciar sesión. Coordina su entrega por el canal acordado.</p>
    <button type="button" className={control} onClick={() => { setSuccess(false); setRoles([]); setPersonMode("new"); void loadLeague(""); }}>Crear otra cuenta</button>
  </div>;

  return <form ref={form} onSubmit={submit} noValidate aria-busy={busy || loading} className="mt-6 space-y-6">
    <p className="text-sm text-muted">Los campos con * son obligatorios.</p>
    {message && <p role="alert" className="rounded-xl border border-danger/25 bg-danger-surface p-4 text-sm text-danger">{message}</p>}
    {sessionCode === "UNAUTHENTICATED" && <ActionLink href="/login">Iniciar sesión</ActionLink>}
    {sessionCode === "PASSWORD_CHANGE_REQUIRED" && <ActionLink href="/change-password">Cambiar contraseña</ActionLink>}
    <fieldset disabled={busy || uncertain || sessionCode === "UNAUTHENTICATED" || sessionCode === "PASSWORD_CHANGE_REQUIRED"} className="space-y-6 disabled:opacity-70">
      <legend className="sr-only">Datos de la nueva cuenta</legend>
      <div className="grid gap-5 sm:grid-cols-2">
        {field("username", "Nombre de usuario", 64)}{field("email", "Correo electrónico", 254, "email")}
      </div>
      {field("temporaryPassword", "Contraseña temporal", 128, "password")}
      <p className="text-sm text-muted">De 8 a 128 caracteres, con mayúscula, minúscula, número y símbolo. No se enviará por correo automáticamente.</p>
      {canReusePerson && select("personMode", "Persona", <><option value="new">Registrar persona</option><option value="existing">Usar UUID conocido de una persona sin cuenta</option></>, personMode, (value) => { setPersonMode(value); setErrors({}); })}
      {personMode === "existing" ? field("person.id", "UUID de persona", 36) : <div className="grid gap-5 sm:grid-cols-2">
        {field("person.firstName", "Nombre(s)", 100)}{field("person.paternalSurname", "Apellido paterno", 100)}{field("person.maternalSurname", "Apellido materno", 100, "text", false)}
      </div>}
      {feedback("person")}
      {select("leagueId", "Liga (excepto SUPERADMIN global)", <><option value="">Selecciona una liga</option>{initial.leagues.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</>, league, (value) => { void loadLeague(value); })}
      <p role="status" className="text-sm text-muted">{loading ? "Cargando roles y clubes autorizados…" : !options.roles.length ? "No hay roles disponibles para este ámbito. Selecciona otra liga o consulta al administrador." : "Se muestran únicamente roles disponibles según tus permisos."}</p>
      <fieldset disabled={loading} aria-describedby={errors.roles ? `${id}-roles-error` : undefined}>
        <legend className="text-sm font-medium">Roles *</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{options.roles.filter((role) => accountRoleCodes.some((code) => code === role.code)).map((role) => <label key={role.code} className="flex min-h-12 items-center gap-3 rounded-xl border border-border p-3 text-sm">
          <input type="checkbox" name="roles" value={role.code} checked={roles.includes(role.code)} aria-invalid={Boolean(errors.roles)}
            onChange={(event) => { setErrors({}); setRoles(event.target.checked ? role.code === "SUPERADMIN" ? [role.code] : [...roles.filter((code) => code !== "SUPERADMIN"), role.code] : roles.filter((code) => code !== role.code)); }} className="size-5 accent-primary" />{role.name}
        </label>)}</div>{feedback("roles")}
      </fieldset>
      {global && <p className="rounded-xl bg-soft p-4 text-sm">SUPERADMIN se asignará de forma global y exclusiva; no se enviará la liga seleccionada.</p>}
      {delegate && <div className="space-y-5">
        {select("clubMode", "Registro de club", <><option value="existing">Club existente</option>{createClubLeagues.includes(league) && <option value="new">Crear registro inicial</option>}</>, clubMode, (value) => { setClubMode(value); setErrors({}); })}
        {clubMode === "new" ? field("club.name", "Nombre del club", 150) : select("club.id", "Club", <><option value="">Selecciona un club</option>{options.clubs.map((club) => <option key={club.id} value={club.id}>{club.name} · {club.reference_number}</option>)}</>)}
        {feedback("club")}
        <p className="text-sm text-muted">Se muestran hasta 100 clubes activos de la liga. El registro inicial permite habilitar al delegado; no implica afiliación aprobada ni inscripción de equipos.</p>
      </div>}
      <button type="submit" disabled={loading || !roles.length || (!global && !league)} className="min-h-12 w-full rounded-xl primary-action px-5 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{busy ? "Creando cuenta…" : "Crear cuenta"}</button>
    </fieldset>
    <p role="status" className="text-sm text-muted">{busy ? "Esperando confirmación del servidor…" : uncertain ? "El envío quedó detenido para evitar un alta repetida. Verifica el resultado antes de abrir un nuevo formulario." : "Se necesita conexión para crear la cuenta. La contraseña se limpia después de cada envío."}</p>
  </form>;
}
