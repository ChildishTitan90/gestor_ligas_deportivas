import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { EmailConfirmationForm } from "@/features/accounts/components/email-confirmation-form";

export const metadata: Metadata = {
  title: "Confirmar correo", referrer: "no-referrer", robots: { index: false, follow: false },
};
export default async function EmailConfirmationPage() {
  const current = await getCurrentAccount();
  return <PublicShell current={current}>
    <section aria-labelledby="email-confirmation-title" className="mx-auto max-w-xl space-y-6 rounded-3xl border border-border bg-surface p-6 sm:p-9">
      <h1 id="email-confirmation-title" className="text-2xl font-semibold text-primary">Confirmar nuevo correo</h1>
      <EmailConfirmationForm />
    </section>
  </PublicShell>;
}
