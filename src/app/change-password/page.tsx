import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { AccountHeader } from "@/components/layout/account-header";
import { ChangePasswordForm } from "@/features/auth/components/change-password-form";

export const metadata: Metadata = { title: "Actualiza tu contraseña" };

export default async function ChangePasswordPage() {
  const current = await getCurrentAccount();

  if (!current) redirect("/login");
  if (!current.mustChangePassword) redirect("/access");

  return (
    <>
    <AccountHeader account={current.account} mustChangePassword />
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-6 py-10">
      <section aria-labelledby="password-title" className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
        <div className="h-1 bg-accent" />
        <div className="p-6 sm:p-9">
          <h1 id="password-title" className="text-2xl font-semibold tracking-tight text-primary">Actualiza tu contraseña</h1>
          <p className="mt-4 text-sm leading-7 text-muted">
            Cambia tu contraseña temporal. Después vuelve a iniciar sesión con la nueva contraseña.
          </p>
          
          <ChangePasswordForm />
        </div>
      </section>
    </main>
    </>
  );
}
