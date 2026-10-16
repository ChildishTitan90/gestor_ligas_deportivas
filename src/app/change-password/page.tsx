import { SessionActivity } from "@/features/auth/components/session-activity";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthSession } from "@/server/auth/session";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";

export const metadata: Metadata = { title: "Actualiza tu contraseña" };

export default async function ChangePasswordPage() {
  const session = await getAuthSession();

  if (!session?.user) redirect("/login");
  if (!session.user.mustChangePassword) redirect("/access");

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center px-6 py-10">
      <SessionActivity />
      <p className="mb-6 text-sm font-semibold text-primary">Liga Municipal <span className="font-normal text-muted">· Morelia</span></p>
      <section aria-labelledby="password-title" className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
        <div className="h-1 bg-accent" />
        <div className="p-6 sm:p-9">
          <p className="mb-3 text-xs font-semibold tracking-widest text-muted uppercase">Un paso antes de continuar</p>
          <h1 id="password-title" className="text-2xl font-semibold tracking-tight text-primary">Actualiza tu contraseña</h1>
          <p className="mt-4 text-sm leading-7 text-muted">
            Tu cuenta usa una contraseña temporal. Debes cambiarla antes de acceder a las funciones de la liga.
          </p>
          
          <ChangePasswordForm />
          {/* NextAuth sirve una página HTML en este endpoint; requiere navegación completa. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/auth/signout" className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border px-5 py-3 text-sm font-semibold text-primary transition-colors hover:bg-background">
            Salir de la cuenta
          </a>
        </div>
      </section>
    </main>
  );
}
