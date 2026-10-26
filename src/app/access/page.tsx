import { CreateAccountLink } from "@/features/accounts/components/create-account-link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthAccessError } from "@/server/auth/session";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { AccountHeader } from "@/components/layout/account-header";
import { ActionLink } from "@/components/ui/action-link";
import { AccessOverview } from "@/features/auth/components/access-overview";
import { getAccessOverview } from "@/features/auth/server/access-overview";
import { AuthorizationError } from "@/server/auth/authorization";

export const metadata: Metadata = { title: "Acceso a la liga" };

export default async function AccessPage() {
  const current = await getCurrentAccount({ includeAssignments: true });

  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");

  let scopes;
  try {
    scopes = await getAccessOverview();
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError) redirect("/login");
    throw error;
  }

  return (
    <>
    <AccountHeader account={current.account} />
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10 sm:px-10">
      <div className="grid items-start gap-6 lg:grid-cols-[0.7fr_1.3fr]">
        <section aria-labelledby="access-title" className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
          <div className="h-1 bg-accent" />
          <div className="p-6 sm:p-9">
            <span aria-hidden="true" className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-soft text-primary">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="m6 12 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <p className="mb-2 text-xs font-semibold tracking-widest text-muted uppercase">Sesión iniciada</p>
            <h1 id="access-title" className="text-2xl font-semibold tracking-tight text-primary">Bienvenido a la liga</h1>
            <p className="mt-4 text-sm leading-7 text-muted">
              Tu sesión está activa. Consulta las funciones autorizadas para tus ámbitos de participación.
            </p>
            <ActionLink href="/futbol" variant="secondary" className="mt-6 w-full">Ver portal de fútbol</ActionLink>
            <ActionLink href="/teams/registrations" variant="secondary" className="mt-3 w-full">Inscripción y consulta de equipos</ActionLink>
            <CreateAccountLink />
          </div>
        </section>
        <AccessOverview scopes={scopes} />
      </div>
    </main>
    </>
  );
}
