"use client";
import { useState } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { accountCredentialsSchema } from "../credentials";
import { accountValidationErrors } from "../form-feedback";
import { refereeAccessMessages, refereeAccessOperation, type RefereeAccessWorkspace } from "../referee-access-contract";
import { useRefereeOperation } from "@/features/referees/components/use-referee-operation";
import { OperationFields } from "@/features/referees/components/operation-fields";

const input = "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface p-3 disabled:opacity-50";
export function RefereeAccessForm({ workspace: w }: { workspace: RefereeAccessWorkspace }) {
  const [username, setUsername] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string,string>>({}), [notice, setNotice] = useState("");
  const operation = useRefereeOperation({ actorId: w.actorId, endpoint: "/api/referee-access", storageNamespace: "referee-access",
    schema: refereeAccessOperation, messages: refereeAccessMessages,
    buildRequest: payload => payload.kind === "create" ? { ...payload, temporaryPassword: password } : payload,
    onRecovered: () => { setPassword(""); setNotice("Acceso confirmado al consultar el acuse. Se conservó la misma Persona y no se duplicó la operación."); } });
  const saved = operation.savedCommand;
  const retryNeedsPassword = operation.uncertain && saved?.kind === "create";
  const otherContext = saved && (saved.refereeId !== w.refereeId || saved.seasonId !== w.seasonId);
  const ready = !w.blockedCode && !w.account?.hasAccess;
  const disabled = operation.pending || operation.uncertain;
  return <section className="mx-auto max-w-3xl space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-muted">Arbitraje / Acceso</p><h1 className="mt-2 text-3xl font-semibold text-primary">Acceso del árbitro</h1><p className="mt-2 text-muted">{w.name} · {w.club} · {w.season}</p><p className="mt-1 text-sm text-muted">{w.league}</p></div>
    <p className="rounded-2xl border border-border bg-surface p-5 text-sm leading-6">Se utiliza la Persona ya incorporada. Este paso habilita únicamente el rol Árbitro en esta liga; los partidos requieren una designación efectiva aprobada.</p>
    {notice && <p role="status" className="rounded-xl border border-positive bg-positive-surface p-4 text-positive">{notice}</p>}
    {w.blockedCode && <p role="alert" className="rounded-xl border border-danger bg-danger-surface p-4 text-danger">{refereeAccessMessages[w.blockedCode]}</p>}
    {w.account?.hasAccess && !w.blockedCode && <p role="status" className="rounded-xl border border-positive bg-positive-surface p-4 text-positive">La Persona ya tiene cuenta y acceso arbitral en esta liga. Se conservan sus credenciales y su cuenta.</p>}
    {(ready || operation.hasOperation) && <form className="space-y-5 rounded-2xl border border-border bg-surface p-5 sm:p-6" onSubmit={async event => {
      event.preventDefault(); setErrors({});
      const credentials = !w.account ? accountCredentialsSchema.safeParse({ username, email, temporaryPassword: password }) : null;
      if (credentials && !credentials.success) {
        setErrors(accountValidationErrors(credentials.error.issues));
        const field=credentials.error.issues[0]?.path[0];
        document.getElementById(field==="temporaryPassword"?"referee-access-password":`referee-access-${String(field)}`)?.focus();
        return;
      }
      const command = { refereeId: w.refereeId, seasonId: w.seasonId, expectedRefereeVersion: w.refereeVersion, expectedIdentityVersion: w.identityVersion,
        ...(w.account ? { kind: "enable", userId: w.account.id, expectedUserVersion: w.account.version } : { kind: "create", username: credentials!.data!.username, email: credentials!.data!.email }) };
      if (await operation.mutate(command)) { setPassword(""); setNotice(w.account ? "Acceso arbitral habilitado en la cuenta existente. Se conservaron sus credenciales y otros roles." : "Cuenta creada sobre la misma Persona, con rol Árbitro y cambio de contraseña obligatorio al primer ingreso."); }
    }}>
      {otherContext ? <p className="text-sm">Hay una operación pendiente de otro árbitro o temporada. Consulta su resultado antes de iniciar una distinta.</p> : <>
      {(!w.account || saved?.kind === "create") ? <>
        <fieldset disabled={disabled} className="space-y-4">
          <div><label className="block text-sm font-semibold">Nombre de usuario<input id="referee-access-username" name="username" required autoComplete="off" maxLength={64} aria-invalid={!!errors.username} aria-describedby={errors.username?"referee-access-username-error":undefined} value={typeof saved?.username === "string" ? saved.username : username} onChange={e => setUsername(e.target.value)} className={input}/></label>{errors.username&&<p id="referee-access-username-error" className="mt-2 text-sm text-danger">{errors.username}</p>}</div>
          <div><label className="block text-sm font-semibold">Correo de acceso<input id="referee-access-email" name="email" type="email" required autoComplete="off" maxLength={254} aria-invalid={!!errors.email} aria-describedby={errors.email?"referee-access-email-error":undefined} value={typeof saved?.email === "string" ? saved.email : email} onChange={e => setEmail(e.target.value)} className={input}/></label>{errors.email&&<p id="referee-access-email-error" className="mt-2 text-sm text-danger">{errors.email}</p>}</div>
        </fieldset>
        <label className="block text-sm font-semibold">{retryNeedsPassword ? "Vuelve a escribir la misma contraseña temporal para un posible reintento" : "Contraseña temporal"}<input id="referee-access-password" name="temporaryPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={operation.pending} value={password} onChange={e => setPassword(e.target.value)} aria-invalid={!!errors.temporaryPassword} aria-describedby={`referee-password-help${errors.temporaryPassword?" referee-access-password-error":""}`} className={input}/></label>
        {errors.temporaryPassword&&<p id="referee-access-password-error" className="text-sm text-danger">{errors.temporaryPassword}</p>}
        <p id="referee-password-help" className="text-sm text-muted">Entre 8 y 128 caracteres, con mayúscula, minúscula, número y símbolo. Comunícala al árbitro por el canal acordado; deberá cambiarla al ingresar. No se envían correos desde esta operación.</p>
      </> : <p className="text-sm">La Persona ya tiene una cuenta. Se conservarán su contraseña, correo y otros roles; solo se habilitará su acceso como árbitro en esta liga.</p>}
      </>}
      <OperationFields live={{ ...operation, retryReady: operation.retryReady && !otherContext && (!retryNeedsPassword || accountCredentialsSchema.shape.temporaryPassword.safeParse(password).success) }} reasonPlaceholder="Ej. Se habilita el acceso del árbitro incorporado para esta liga."/>
      {retryNeedsPassword && <p className="text-sm text-muted">La contraseña no se conserva al recargar. Primero consulta el acuse; reintenta solo la solicitud original con la misma contraseña.</p>}
      <button type="submit" disabled={disabled || !ready || !!notice} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50">{operation.pending ? "Comprobando operación…" : w.account ? "Habilitar acceso de árbitro" : "Crear cuenta de árbitro"}</button>
    </form>}
    <div className="flex flex-wrap gap-3"><ActionLink variant="secondary" href="/referees/presentations" onClick={e=>{if(operation.pending||operation.uncertain)e.preventDefault();}}>Volver a presentaciones</ActionLink><ActionLink variant="secondary" href={`/referees?league=${w.leagueId}&season=${w.seasonId}`} onClick={e=>{if(operation.pending||operation.uncertain)e.preventDefault();}}>Volver al padrón</ActionLink></div>
  </section>;
}
