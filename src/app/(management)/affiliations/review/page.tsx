import { AffiliationReviewWorkspace } from "@/features/clubs/components/affiliation-review-workspace";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/action-link";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { getAffiliationReviewLeagueOptions } from "@/features/clubs/server/affiliation-review-service";

export const metadata: Metadata = {
  title: "Revisión de afiliaciones",
};

export default async function AffiliationReviewPage() {
  const current = await getCurrentAccount();

  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  const leagues = await getAffiliationReviewLeagueOptions();

  return (
      <div className="mx-auto w-full max-w-6xl">
        <ActionLink href="/access" variant="secondary">
          Volver al panel
        </ActionLink>

        <section
          aria-labelledby="affiliation-review-title"
          className="mt-6"
        >
          <h1
            id="affiliation-review-title"
            className="text-2xl font-semibold tracking-tight text-primary"
          >
            Revisión de afiliaciones
          </h1>

          <p className="mt-3 text-sm leading-6 text-muted">
            Busca una solicitud y consulta su revisión. Elige una liga de tu ámbito autorizado.
          </p>

          <AffiliationReviewWorkspace leagues={leagues} />
        </section>
      </div>
  );
}
