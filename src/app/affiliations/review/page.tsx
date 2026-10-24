import { AffiliationReviewWorkspace } from "@/features/clubs/components/affiliation-review-workspace";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountHeader } from "@/components/layout/account-header";
import { ActionLink } from "@/components/ui/action-link";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";

export const metadata: Metadata = {
  title: "Revisión de afiliaciones",
};

export default async function AffiliationReviewPage() {
  const current = await getCurrentAccount({ includeAssignments: true });

  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");

  return (
    <>
      <AccountHeader account={current.account} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 sm:px-10">
        <ActionLink href="/access" variant="secondary">
          Volver al panel
        </ActionLink>

        <section
          aria-labelledby="affiliation-review-title"
          className="mt-6 rounded-3xl border border-border bg-surface p-5 sm:p-8"
        >
          <h1
            id="affiliation-review-title"
            className="text-2xl font-semibold tracking-tight text-primary"
          >
            Revisión de afiliaciones
          </h1>

          <p className="mt-3 text-sm leading-6 text-muted">
            Consulta y revisión de solicitudes de afiliación de clubes.
          </p>

          <AffiliationReviewWorkspace />
        </section>
      </main>
    </>
  );
}