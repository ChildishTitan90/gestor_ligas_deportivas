import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { EmailConfirmationForm } from "@/features/accounts/components/email-confirmation-form";

export const metadata: Metadata = {
  title: "Confirmar correo", referrer: "no-referrer", robots: { index: false, follow: false },
};
export default async function EmailConfirmationPage() {
  const current = await getCurrentAccount();
  return <PublicShell football current={current} showSignIn={false}>
    <section aria-labelledby="email-confirmation-title" className="mx-auto max-w-xl space-y-5 rounded-3xl border border-border bg-surface p-5 sm:p-8">
      <h1 id="email-confirmation-title" className="text-2xl font-semibold tracking-tight text-primary">Confirmar nuevo correo</h1>
      <EmailConfirmationForm />
    </section>
  </PublicShell>;
}
