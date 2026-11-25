import { notFound } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ChargeAccessDenied, ChargeDemoNotice } from "@/features/billing/components/charge-demo-state";
import { ChargeDetails } from "@/features/billing/components/charge-details";
import { chargesPath, chargesUrl, readChargeFilters, type DemoQuery } from "@/features/billing/demo-data";
import { chargeConceptLabels } from "@/features/billing/schemas";
import { getChargeDemoDetail } from "@/features/billing/server/queries";

export const metadata = { title: "Detalle del cargo" };

export default async function ChargeDetailPage({ params, searchParams }: {
  params: Promise<{ chargeId: string }>;
  searchParams: Promise<DemoQuery>;
}) {
  const detail = await getChargeDemoDetail((await params).chargeId);
  if (detail.status === "DENIED") return <ChargeAccessDenied />;
  const { charge } = detail;
  if (!charge) notFound();
  const back = chargesUrl(chargesPath, readChargeFilters(await searchParams));

  return <section className="mx-auto max-w-4xl space-y-5">
    <ManagementPageHeader title={chargeConceptLabels[charge.concept]} description="Detalle e historial del cargo de ejemplo."
      back={{ href: back, label: "Volver a cargos" }} />
    <ChargeDemoNotice />
    <ChargeDetails charge={charge} />
  </section>;
}
