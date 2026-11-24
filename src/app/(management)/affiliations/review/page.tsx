import { AffiliationReviewWorkspace } from "@/features/clubs/components/affiliation-review-workspace";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { getAffiliationReviewLeagueOptions } from "@/features/clubs/server/affiliation-review-service";

export const metadata: Metadata = {
  title: "Revisión de afiliaciones",
};

export default async function AffiliationReviewPage({ searchParams }: { searchParams: Promise<{ league?: string | string[] }> }) {
  const current = await getCurrentAccount();

  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  const leagues = await getAffiliationReviewLeagueOptions();
  const { league } = await searchParams;
  const initialLeague = typeof league === "string" && leagues.some(option => option.id === league) ? league : undefined;

  return <div className="mx-auto w-full max-w-6xl">
    <ManagementPageHeader title="Revisión de afiliaciones"
      description="Consulta solicitudes por liga, revisa sus requisitos y registra la decisión que corresponda."
      back={{ href: "/access", label: "Mi panel" }} />
    <AffiliationReviewWorkspace key={initialLeague} leagues={leagues} initialLeague={initialLeague} />
  </div>;
}
