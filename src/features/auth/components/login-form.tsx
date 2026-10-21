"use client";

import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { loginSchema } from "@/features/auth/schemas";

type FieldErrors = { email?: string; password?: string };
type LoginError = { title: string; description: string };

const invalidCredentialsError: LoginError = {
  title: "Correo o contraseña incorrectos",
  description: "Revisa tus datos e inténtalo de nuevo. Si necesitas ayuda para acceder, comunícate con la administración de la liga.",
};
const serviceError: LoginError = {
  title: "No pudimos conectar con el servicio",
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

export function LoginForm() {
  const router = useRouter();
  const isOnline = useSyncExternalStore(subscribeToConnection, getConnectionStatus, () => true);
  const pendingRef = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<LoginError>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;

    setError(undefined);
    setFieldErrors({});

    if (!isOnline) {
      setError({
        title: "No hay conexión",
        description: "Comprueba tu conexión e inténtalo de nuevo. Para iniciar sesión necesitas acceso a internet.",
      });
      return;
    }

    const formData = new FormData(event.currentTarget);
    const result = loginSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    if (!result.success) {
      const fields: FieldErrors = {};
      for (const issue of result.error.issues) {
        if (issue.path[0] === "email") fields.email = "Escribe un correo electrónico válido.";
        if (issue.path[0] === "password") fields.password = issue.message;
      }
      setFieldErrors(fields);
      return;
    }

    pendingRef.current = true;
    setIsSubmitting(true);
    let authenticated = false;

    try {
      const response = await signIn("credentials", {
        ...result.data,
        redirect: false,
        callbackUrl: "/access",
      });

      if (!response?.ok || response.error) {
        setError(response?.error === "CredentialsSignin" ? invalidCredentialsError : serviceError);
        return;
      }

      authenticated = true;
      router.push("/access");
      router.refresh();
    } catch {
      setError(serviceError);
    } finally {
      if (passwordRef.current) passwordRef.current.value = "";
      setShowPassword(false);
      if (!authenticated) {
        pendingRef.current = false;
        setIsSubmitting(false);
      }
    }
  }

  const feedback = error ?? (Object.keys(fieldErrors).length > 0 ? {
    title: "Revisa tus datos",
    description: "Hay campos que necesitan atención. Corrige los datos señalados para continuar.",
  } : undefined);

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
      <div aria-live="polite">
        {!isOnline && (
          <p className="mb-5 rounded-xl border border-border bg-background p-3 text-sm leading-6 text-primary">
            Sin conexión. Para iniciar sesión necesitas acceso a internet.
          </p>
        )}
      </div>
      {feedback && (
        <div
          role="alert"
          aria-labelledby="login-error-title"
          aria-describedby="login-error-description"
          className="mb-6 flex items-start gap-3 rounded-xl border border-danger/25 bg-danger-surface p-4"
        >
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-danger">
            <CircleAlert size={20} />
          </span>
          <div className="min-w-0">
            <p id="login-error-title" className="text-sm font-semibold leading-6 text-danger">{feedback.title}</p>
            <p id="login-error-description" className="mt-1 text-sm leading-6 text-foreground">{feedback.description}</p>
          </div>
        </div>
      )}

      <fieldset disabled={isSubmitting} className="space-y-5 disabled:opacity-70">
        <legend className="sr-only">Datos de acceso</legend>
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium">Correo electrónico</label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            required
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            className="h-12 w-full rounded-xl border border-border bg-surface px-3.5 text-base transition-colors placeholder:text-muted focus:border-primary"
            placeholder="tu.correo@ejemplo.com"
          />
          {fieldErrors.email && <p id="email-error" className="mt-2 text-sm text-danger">{fieldErrors.email}</p>}
        </div>
        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium">Contraseña</label>
          <div className="relative">
            <input
              ref={passwordRef}
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              maxLength={1024}
              required
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              className="h-12 w-full rounded-xl border border-border bg-surface py-3 pr-14 pl-3.5 text-base transition-colors placeholder:text-muted focus:border-primary"
            />
            <button
              type="button"
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-controls="password"
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute inset-y-1 right-1 flex w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-primary disabled:cursor-not-allowed"
            >
              {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </div>
          {fieldErrors.password && <p id="password-error" className="mt-2 text-sm text-danger">{fieldErrors.password}</p>}
        </div>
        <button
          type="submit"
          disabled={!isOnline || isSubmitting}
          className="mt-1 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-surface transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting && <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-surface/40 border-t-surface motion-reduce:animate-none" />}
          {isSubmitting ? "Verificando acceso…" : "Iniciar sesión"}
        </button>
      </fieldset>
      <p role="status" className="sr-only">{isSubmitting ? "Verificando tus datos. Espera un momento." : ""}</p>
      <noscript><p className="mt-4 text-sm text-danger">Activa JavaScript para iniciar sesión.</p></noscript>
    </form>
  );
}
