import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ChargeAccessDenied } from "@/features/billing/components/charge-access-denied";
import { ChargeForm } from "@/features/billing/components/charge-form";
import { chargesPath, chargesUrl, type BillingQuery } from "@/features/billing/navigation";
import { getChargeCapture } from "@/features/billing/server/queries";
import { billingPageQuery } from "@/features/billing/server/page-access";

export const metadata = { title: "Nuevo cargo de tesorería" };

export default async function NewChargePage({ searchParams }: { searchParams: Promise<BillingQuery> }) {
  const query = await searchParams;
  const workspace = await billingPageQuery(() => getChargeCapture(query));
  if (!workspace) return <ChargeAccessDenied creating />;
  const { filters } = workspace;
  const back = chargesUrl(chargesPath, filters);
  const { seasons } = workspace;
  return <section className="mx-auto max-w-4xl space-y-5">
    <ManagementPageHeader title="Nuevo cargo" description="Captura y revisa un cargo para un club o equipo."
      back={{ href: back, label: "Volver a cargos" }} />
    <ChargeForm seasons={seasons} filters={filters} />
  </section>;
}
