import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAccessIdentity } from "@/features/auth/server/queries";
import { getAuthSession } from "@/server/auth/session";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

export const metadata: Metadata = { title: "Acceso a la liga" };

export default async function AccessPage() {
  const session = await getAuthSession();

  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");

  await getAccessIdentity();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center px-6 py-10">
      <p className="mb-6 text-sm font-semibold text-primary">Liga Municipal <span className="font-normal text-muted">· Morelia</span></p>
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
            Tu sesión está activa. Las funciones de la liga estarán disponibles aquí.
          </p>
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
