import { ActionLink } from "@/components/ui/action-link";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

export function ManagementUnavailable() {
  return <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center px-6 py-10">
    <section aria-labelledby="management-error-title" className="rounded-3xl border border-border bg-surface p-6 sm:p-9">
      <h1 id="management-error-title" className="text-2xl font-semibold text-primary">No pudimos cargar el espacio de gestión</h1>
      <p role="alert" className="mt-4 text-sm leading-7 text-muted">No pudimos comprobar tus accesos. Intenta nuevamente para continuar.</p>
      <a href="/access" className="mt-6 flex min-h-12 items-center justify-center rounded-xl primary-action px-5 py-3 text-sm font-semibold">Reintentar</a>
      <ActionLink href="/futbol" variant="secondary" className="mt-3 w-full">Portal público</ActionLink>
      <SignOutButton />
    </section>
  </main>;
}
