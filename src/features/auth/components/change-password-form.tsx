"use client";

import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { signOutCurrentSession } from "../client/sign-out.client";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { changePasswordSchema } from "@/features/auth/schemas";

type FieldErrors = {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
};
type FormError = { title: string; description: string };

const invalidCurrentPasswordError: FormError = {
  title: "Contraseña actual incorrecta",
  description: "La contraseña temporal que ingresaste no coincide. Revisa tus datos e inténtalo de nuevo.",
};

const serviceError: FormError = {
  title: "No pudimos actualizar tu contraseña",
  description: "Inténtalo de nuevo en unos momentos. Si el problema continúa, comunícate con la administración de la liga.",
};

function subscribeToConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getConnectionStatus() {
  return navigator.onLine;
}

export function ChangePasswordForm() {
  const isOnline = useSyncExternalStore(subscribeToConnection, getConnectionStatus, () => true);
  const pendingRef = useRef(false);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<FormError>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;

    setError(undefined);
    setFieldErrors({});

    if (!isOnline) {
      setError({
        title: "No hay conexión",
        description: "Comprueba tu conexión e inténtalo de nuevo. Necesitas acceso a internet para continuar.",
      });
      return;
    }

    const formData = new FormData(event.currentTarget);
    const result = changePasswordSchema.safeParse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });

    if (!result.success) {
      const fields: FieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        if (key && !fields[key]) {
          fields[key] = issue.message;
        }
      }
      setFieldErrors(fields);
      return;
    }

    pendingRef.current = true;
    setIsSubmitting(true);
    let updated = false;

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data?.code === "INVALID_CURRENT_PASSWORD" ? invalidCurrentPasswordError : serviceError);
        return;
      }

      updated = true;
      // El JWT anterior queda revocado. Pedir credenciales nuevas, sin promover
      // la sesión restringida mediante datos enviados desde el navegador.
      try {
        await signOutCurrentSession();
      } finally {
        // Aunque falle la limpieza de cookie por red, la versión ya la revocó.
        // Una navegación completa evita conservar vistas de la sesión anterior.
        window.location.replace("/login");
      }
    } catch {
      setError(serviceError);
    } finally {
      if (currentPasswordRef.current) currentPasswordRef.current.value = "";
      if (newPasswordRef.current) newPasswordRef.current.value = "";
      if (confirmPasswordRef.current) confirmPasswordRef.current.value = "";
      setShowCurrent(false);
      setShowNew(false);
      setShowConfirm(false);
      if (!updated) {
        pendingRef.current = false;
        setIsSubmitting(false);
      }
    }
  }

  const feedback =
    error ??
    (Object.keys(fieldErrors).length > 0
      ? {
        title: "Revisa tus datos",
        description: "Asegúrate de cumplir con todos los requisitos de seguridad de la nueva contraseña.",
      }
      : undefined);

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting} className="mt-6">
      <div aria-live="polite">
        {!isOnline && (
          <p className="mb-5 rounded-xl border border-border bg-background p-3 text-sm leading-6 text-primary">
            Sin conexión. Necesitas acceso a internet para actualizar tu contraseña.
          </p>
        )}
      </div>

      {feedback && (
        <div
          role="alert"
          aria-labelledby="change-password-error-title"
          aria-describedby="change-password-error-description"
          className="mb-6 flex items-start gap-3 rounded-xl border border-danger/25 bg-danger-surface p-4"
        >
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-danger">
            <CircleAlert size={20} />
          </span>
          <div className="min-w-0">
            <p id="change-password-error-title" className="text-sm font-semibold leading-6 text-danger">
              {feedback.title}
            </p>
            <p id="change-password-error-description" className="mt-1 text-sm leading-6 text-foreground">
              {feedback.description}
            </p>
          </div>
        </div>
      )}

      <fieldset disabled={isSubmitting} className="space-y-5 disabled:opacity-70">
        <legend className="sr-only">Actualizar contraseña</legend>

        <div>
          <label htmlFor="currentPassword" className="mb-2 block text-sm font-medium">
            Contraseña temporal actual
          </label>
          <div className="relative">
            <input
              ref={currentPasswordRef}
              id="currentPassword"
              name="currentPassword"
              type={showCurrent ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              maxLength={1024}
              required
              aria-invalid={Boolean(fieldErrors.currentPassword)}
              aria-describedby={fieldErrors.currentPassword ? "currentPassword-error" : undefined}
              className="h-12 w-full rounded-xl border border-border bg-surface py-3 pr-14 pl-3.5 text-base transition-colors placeholder:text-muted focus:border-primary"
            />
            <button
              type="button"
              aria-label={showCurrent ? "Ocultar contraseña actual" : "Mostrar contraseña actual"}
              aria-controls="currentPassword"
              onClick={() => setShowCurrent((v) => !v)}
              className="absolute inset-y-1 right-1 flex w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-primary disabled:cursor-not-allowed"
            >
              {showCurrent ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </div>
          {fieldErrors.currentPassword && (
            <p id="currentPassword-error" className="mt-2 text-sm text-danger">
              {fieldErrors.currentPassword}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="newPassword" className="mb-2 block text-sm font-medium">
            Nueva contraseña
          </label>
          <div className="relative">
            <input
              ref={newPasswordRef}
              id="newPassword"
              name="newPassword"
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Escribe tu nueva contraseña"
              maxLength={128}
              required
              aria-invalid={Boolean(fieldErrors.newPassword)}
              aria-describedby={
                fieldErrors.newPassword
                  ? "newPassword-help newPassword-error"
                  : "newPassword-help"
              }
              className="h-12 w-full rounded-xl border border-border bg-surface py-3 pr-14 pl-3.5 text-base transition-colors placeholder:text-muted focus:border-primary"
            />
            <button
              type="button"
              aria-label={showNew ? "Ocultar nueva contraseña" : "Mostrar nueva contraseña"}
              aria-controls="newPassword"
              onClick={() => setShowNew((v) => !v)}
              className="absolute inset-y-1 right-1 flex w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-primary disabled:cursor-not-allowed"
            >
              {showNew ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </div>
          <p
            id="newPassword-help"
            className="mt-2 text-sm leading-6 text-muted"
          >
            Usa entre 8 y 128 caracteres e incluye al menos una
            mayúscula, una minúscula, un número y un símbolo.
            Debe ser diferente de tu contraseña actual.
          </p>
          {fieldErrors.newPassword && (
            <p id="newPassword-error" className="mt-2 text-sm text-danger">
              {fieldErrors.newPassword}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-2 block text-sm font-medium">
            Confirmar nueva contraseña
          </label>
          <div className="relative">
            <input
              ref={confirmPasswordRef}
              id="confirmPassword"
              name="confirmPassword"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repite tu nueva contraseña"
              maxLength={128}
              required
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              aria-describedby={
                fieldErrors.confirmPassword
                  ? "confirmPassword-help confirmPassword-error"
                  : "confirmPassword-help"
              }
              className="h-12 w-full rounded-xl border border-border bg-surface py-3 pr-14 pl-3.5 text-base transition-colors placeholder:text-muted focus:border-primary"
            />
            <button
              type="button"
              aria-label={showConfirm ? "Ocultar confirmación" : "Mostrar confirmación"}
              aria-controls="confirmPassword"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute inset-y-1 right-1 flex w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-primary disabled:cursor-not-allowed"
            >
              {showConfirm ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </div>
          <p
            id="confirmPassword-help"
            className="mt-2 text-sm leading-6 text-muted"
          >
            Repite exactamente la nueva contraseña.
          </p>
          {fieldErrors.confirmPassword && (
            <p id="confirmPassword-error" className="mt-2 text-sm text-danger">
              {fieldErrors.confirmPassword}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={!isOnline || isSubmitting}
          className="mt-1 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-surface transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-surface/40 border-t-surface motion-reduce:animate-none"
            />
          )}
          {isSubmitting ? "Actualizando contraseña…" : "Guardar nueva contraseña"}
        </button>
      </fieldset>
    </form>
  );
}
