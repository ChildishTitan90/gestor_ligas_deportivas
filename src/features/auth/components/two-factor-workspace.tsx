"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { SelectField } from "@/components/ui/select-field";
import { FormDialog } from "@/components/ui/form-dialog";
import { SignOutButton } from "./sign-out-button";
import type { TwoFactorCommand, TwoFactorResult } from "../two-factor-contract";
const field =
  "mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 py-3 text-foreground";
const button =
  "primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-60";
const messages: Record<string, string> = {
  INVALID_PROOF:
    "No pudimos verificar los datos. Revisa la contraseña o el código e inténtalo de nuevo.",
  MFA_BLOCKED:
    "Se agotaron los cinco intentos. Espera hasta la hora indicada; iniciar otra sesión no elimina el bloqueo.",
  CONFLICT:
    "La configuración cambió. Consulta el estado oficial antes de continuar.",
  ENROLLMENT_EXPIRED:
    "La configuración caducó o ya se utilizó. Consulta el estado e inicia una nueva configuración.",
  UNAUTHENTICATED: "La sesión caducó o fue revocada. Vuelve a iniciar sesión.",
  FORBIDDEN:
    "Tu cuenta no tiene un rol vigente que permita configurar el segundo factor.",
  PASSWORD_CHANGE_REQUIRED: "Primero actualiza tu contraseña.",
  UNAVAILABLE:
    "El servicio no está disponible. Consulta el estado antes de repetir una operación.",
};
export function TwoFactorWorkspace({
  challenge = false,
  recovery = false,
}: {
  challenge?: boolean;
  recovery?: boolean;
}) {
  const flight = useRef(false),
    notice = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<TwoFactorResult | null>(null),
    [enrollment, setEnrollment] = useState<TwoFactorResult | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null),
    [method, setMethod] = useState("totp"),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [disable, setDisable] = useState(false);
  const [copied, setCopied] = useState(false),
    [deadline, setDeadline] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(recovery);
  useEffect(() => {
    if (message) notice.current?.focus();
  }, [message]);
  useEffect(() => {
    if (!enrollment && !codes) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [enrollment, codes]);
  async function send(command: TwoFactorCommand) {
    if (flight.current) return null;
    flight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/two-factor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      const data: TwoFactorResult = await response.json();
      if (!response.ok) {
        setMessage(messages[data.code] ?? "No se pudo completar la operación.");
        setDeadline(data.retryAt ?? null);
        return null;
      }
      setUncertain(false);
      setDeadline(null);
      return data;
    } catch {
      setUncertain(true);
      setMessage(
        "No recibimos el resultado. La operación puede haberse completado. Consulta el estado oficial antes de continuar; los códigos no se vuelven a mostrar.",
      );
      return null;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function status() {
    const data = await send({ action: "status" });
    if (!data) return;
    setState(data);
    setEnrollment(null);
    setPassword("");
    setCode("");
    if (data.pending)
      setMessage(
        "Hay una configuración pendiente. Por seguridad no se vuelve a mostrar la clave. Puedes iniciar otra configuración si conservas acceso al factor anterior. En recuperación, cierra sesión y usa otro código para reiniciar.",
      );
  }
  useEffect(() => {
    // Defer the first request until hydration, and cancel the scheduled request if unmounted.
    const timer = window.setTimeout(() => void status(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const revision = state?.revision ?? 0;
    const command: TwoFactorCommand = enrollment
      ? {
          action: "confirm",
          operation: enrollment.operation!,
          revision: enrollment.revision!,
          code,
        }
      : challenge
        ? { action: method === "backup" ? "recover" : "verify", code }
        : {
            action: "begin",
            password,
            revision,
            ...(state?.active
              ? { proof: { method: method as "totp" | "backup", code } }
              : {}),
          };
    const data = await send(command);
    if (!data) return;
    setPassword("");
    setCode("");
    if (data.code === "ENROLLMENT_PENDING") {
      setEnrollment(data);
      if (challenge) setRecovering(true);
      setMessage(
        "Pendiente de confirmar. Añade la clave a tu aplicación autenticadora e introduce un código del factor nuevo.",
      );
    }
    if (data.code === "VERIFIED") {
      window.location.replace("/access");
    }
    if (data.code === "REAUTHENTICATE") {
      setEnrollment(null);
      setCodes(data.codes ?? []);
      setMessage(
        "Segundo factor actualizado. Todas las sesiones fueron revocadas. Guarda los códigos antes de volver a iniciar sesión.",
      );
    }
  }
  async function confirmDisable() {
    const data = await send({
      action: "disable",
      password,
      proof: { method: method as "totp" | "backup", code },
      revision: state?.revision ?? 0,
    });
    if (data) {
      setDisable(false);
      setPassword("");
      setCode("");
      setCodes([]);
      setMessage(
        "Segundo factor desactivado. Todas las sesiones fueron revocadas. Inicia sesión de nuevo.",
      );
    }
  }
  const showProof = challenge || !!state?.active;
  return (
    <section
      className="mx-auto w-full max-w-2xl space-y-6 rounded-3xl border border-border bg-surface p-5 sm:p-8"
      aria-label="Verificación en dos pasos"
    >
      <p className="text-sm leading-6 text-muted">
        {challenge
          ? "Tu contraseña fue validada. Solo puedes verificar este acceso o cerrar sesión. El desafío caduca a los 10 minutos."
          : "Protege tu cuenta con una aplicación autenticadora. Es opcional para los roles autorizados. Activar, cambiar o desactivar cierra todas tus sesiones."}
      </p>
      <p
        ref={notice}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="rounded-xl text-sm leading-6 text-primary focus-visible:outline-2 focus-visible:outline-accent"
      >
        {message}
      </p>
      {deadline && (
        <p className="text-sm text-danger">
          Bloqueado hasta {new Date(deadline).toLocaleTimeString("es-MX")}
        </p>
      )}
      {!state && !message && <p role="status">Consultando configuración…</p>}
      {state && !challenge && !codes && (
        <p className="font-semibold text-primary">
          Estado oficial: {state.active ? "Activo" : "Sin factor activo"} ·
          Códigos disponibles: {state.remainingCodes}
        </p>
      )}
      {codes ? (
        <div className="space-y-4">
          {codes.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-primary">
                Guarda tus 10 códigos de respaldo
              </h2>
              <p className="text-sm text-muted">
                Esta es su única entrega. Cada código sirve una vez. No
                compartas esta pantalla ni la captures para una incidencia.
              </p>
              <ul
                aria-label="Códigos de respaldo"
                className="space-y-2 break-all rounded-xl bg-background p-4 font-mono text-sm"
              >
                {codes.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
              <label className="flex min-h-12 items-center gap-3">
                <input
                  type="checkbox"
                  checked={copied}
                  onChange={(e) => setCopied(e.target.checked)}
                />{" "}
                He guardado los códigos en un lugar seguro
              </label>
            </>
          )}
          <button
            className={button}
            disabled={codes.length > 0 && !copied}
            onClick={() => {
              setCodes(null);
              window.location.replace("/login");
            }}
          >
            Volver a iniciar sesión
          </button>
        </div>
      ) : (
        state &&
        (challenge || state.eligible) && (
          <>
            {recovering && !enrollment && (
              <p className="text-sm text-danger">
                Esta sesión solo permite confirmar el factor nuevo. Si
                recargaste la página y perdiste la clave, cierra sesión y
                reinicia la recuperación con otro código. El anterior ya se
                consumió.
              </p>
            )}
            {enrollment && (
              <div className="space-y-3 rounded-xl bg-background p-4">
                <h2 className="font-semibold text-primary">
                  Pendiente de confirmar
                </h2>
                <p className="text-sm text-muted">
                  En tu aplicación elige añadir una cuenta con clave manual,
                  tipo TOTP. Usa esta clave y un intervalo de 30 segundos:
                </p>
                <p
                  aria-label="Clave de configuración"
                  className="break-all font-mono text-lg select-all"
                >
                  {enrollment.secret}
                </p>
                <p className="text-sm text-muted">
                  Caduca:{" "}
                  {new Date(enrollment.expiresAt!).toLocaleTimeString("es-MX")}.
                  El factor anterior sigue vigente hasta confirmar.
                </p>
              </div>
            )}
            {(!recovering || enrollment) && (
              <form onSubmit={submit} className="space-y-5" aria-busy={busy}>
                {!challenge && !enrollment && (
                  <label
                    className="block text-sm font-medium text-primary"
                    htmlFor="mfa-password"
                  >
                    Contraseña actual
                    <input
                      id="mfa-password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={1024}
                      className={field}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                )}
                {showProof && !enrollment && (
                  <div>
                    <label
                      htmlFor="mfa-method"
                      className="mb-2 block text-sm font-medium text-primary"
                    >
                      {challenge
                        ? "Cómo continuar"
                        : "Verificación del factor actual"}
                    </label>
                    <SelectField
                      id="mfa-method"
                      name="method"
                      value={method}
                      onValueChange={setMethod}
                      searchable={false}
                      options={[
                        { value: "totp", label: "Código de la aplicación" },
                        {
                          value: "backup",
                          label: challenge
                            ? "Perdí el autenticador: recuperar con un código"
                            : "Código de respaldo",
                        },
                      ]}
                    />
                  </div>
                )}
                {(showProof || enrollment) && (
                  <label
                    htmlFor="mfa-code"
                    className="block text-sm font-medium text-primary"
                  >
                    {enrollment
                      ? "Código de la aplicación nueva"
                      : method === "backup"
                        ? "Código de respaldo de un solo uso"
                        : "Código de 6 dígitos"}
                    <input
                      id="mfa-code"
                      name="code"
                      autoComplete="one-time-code"
                      inputMode={
                        enrollment || method === "totp" ? "numeric" : "text"
                      }
                      spellCheck={false}
                      required
                      maxLength={64}
                      className={field}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      aria-describedby="mfa-help"
                    />
                  </label>
                )}
                <p id="mfa-help" className="text-sm leading-6 text-muted">
                  {method === "backup" && challenge && !enrollment
                    ? "El código se consumirá y solo permitirá configurar un factor nuevo. Si abandonas o caduca el plazo, el código seguirá consumido y el autenticador anterior seguirá activo. Al confirmar recibirás códigos nuevos y deberás iniciar sesión otra vez."
                    : "Cinco fallos bloquean la verificación durante 15 minutos. Un código de la aplicación no puede reutilizarse; espera al siguiente intervalo."}
                </p>
                {!challenge && !enrollment && (
                  <p className="text-sm leading-6 text-muted">
                    Recibirás 10 códigos de respaldo una sola vez. Si pierdes el
                    autenticador y todos tus códigos, no hay recuperación
                    automática; el procedimiento humano sigue pendiente de
                    acuerdo.
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    className={button}
                    disabled={busy || uncertain}
                  >
                    {busy
                      ? "Verificando…"
                      : enrollment
                        ? "Confirmar factor nuevo"
                        : challenge
                          ? method === "backup"
                            ? "Consumir código y recuperar"
                            : "Verificar acceso"
                          : state.active
                            ? "Preparar cambio de factor"
                            : "Preparar segundo factor"}
                  </button>
                  {enrollment && (
                    <button
                      type="button"
                      className="min-h-12 rounded-xl border border-border px-5 text-primary"
                      disabled={busy || uncertain}
                      onClick={async () => {
                        const data = await send({
                          action: "cancel",
                          operation: enrollment.operation!,
                          revision: enrollment.revision!,
                        });
                        if (data?.code === "REAUTHENTICATE")
                          window.location.replace("/login");
                        else if (data) {
                          setEnrollment(null);
                          await status();
                        }
                      }}
                    >
                      Cancelar configuración
                    </button>
                  )}
                  {!challenge && state.active && !enrollment && (
                    <button
                      type="button"
                      disabled={busy || uncertain}
                      className="min-h-12 rounded-xl border border-border px-5 text-danger"
                      onClick={() => setDisable(true)}
                    >
                      Desactivar factor
                    </button>
                  )}
                </div>
              </form>
            )}
          </>
        )
      )}
      {state && !challenge && !state.eligible && !codes && (
        <p role="alert">
          Tu cuenta no tiene un rol vigente que permita configurar segundo
          factor.
        </p>
      )}
      {!codes && (
        <button
          type="button"
          className="min-h-12 rounded-xl border border-border px-5 text-primary"
          disabled={busy}
          onClick={() => void status()}
        >
          Consultar estado oficial
        </button>
      )}
      {challenge && !codes && <SignOutButton />}
      <FormDialog
        open={disable}
        title="Desactivar segundo factor"
        description="Exige tu contraseña y el código del factor actual o un código de respaldo. Todas las sesiones se cerrarán."
        pending={busy}
        uncertain={uncertain}
        onClose={() => setDisable(false)}
        footer={
          <button
            type="button"
            className={button}
            disabled={busy || uncertain}
            onClick={() => void confirmDisable()}
          >
            {busy ? "Desactivando…" : "Confirmar desactivación"}
          </button>
        }
      >
        <p className="text-sm text-muted">
          Comprueba los datos capturados en la pantalla. Al confirmar volverás a
          iniciar sesión solo con contraseña.
        </p>
      </FormDialog>
    </section>
  );
}
