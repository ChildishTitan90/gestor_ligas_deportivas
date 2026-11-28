import { notFound } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ChargeAccessDenied } from "@/features/billing/components/charge-access-denied";
import { ChargeDetails } from "@/features/billing/components/charge-details";
import { chargesPath, chargesUrl, type BillingQuery } from "@/features/billing/navigation";
import { chargeConceptLabels } from "@/features/billing/schemas";
import { getChargeDetail } from "@/features/billing/server/queries";
import { billingPageQuery } from "@/features/billing/server/page-access";
import { ChargeOperationControl } from "@/features/billing/components/charge-operation-control";

export const metadata = { title: "Detalle del cargo" };

export default async function ChargeDetailPage({ params, searchParams }: {
  params: Promise<{ chargeId: string }>;
  searchParams: Promise<BillingQuery>;
}) {
  const { chargeId } = await params;
  const query = await searchParams;
  const detail = await billingPageQuery(() => getChargeDetail(chargeId, query));
  if (!detail) return <ChargeAccessDenied />;
  const { charge } = detail;
  if (!charge) notFound();
  const back = chargesUrl(chargesPath, detail.filters ?? {});

  return <section className="mx-auto max-w-4xl space-y-5">
    <ManagementPageHeader title={chargeConceptLabels[charge.concept]} description="Detalle e historial del cargo."
      back={{ href: back, label: "Volver a cargos" }} />
    {charge.canModify && <ChargeOperationControl charge={charge} />}
    {charge.modificationBlocked && <p className="rounded-xl border border-border bg-soft px-4 py-3 text-sm text-primary">{charge.modificationBlocked}</p>}
    <ChargeDetails charge={charge} />
  </section>;
}
