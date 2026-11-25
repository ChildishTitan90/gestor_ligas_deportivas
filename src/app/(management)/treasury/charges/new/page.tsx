import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ChargeAccessDenied, ChargeDemoNotice } from "@/features/billing/components/charge-demo-state";
import { ChargeForm } from "@/features/billing/components/charge-form";
import { chargesPath, chargesUrl, type DemoQuery } from "@/features/billing/demo-data";
import { getChargeDemoCapture } from "@/features/billing/server/queries";

export const metadata = { title: "Nuevo cargo de tesorería" };

export default async function NewChargePage({ searchParams }: { searchParams: Promise<DemoQuery> }) {
  const workspace = await getChargeDemoCapture(await searchParams);
  if (workspace.status === "DENIED") return <ChargeAccessDenied />;
  const { filters } = workspace;
  const back = chargesUrl(chargesPath, filters);
  if (workspace.status === "READ_ONLY") return <ChargeAccessDenied creating back={back} />;
  const { seasons, response } = workspace;
  return <section className="mx-auto max-w-4xl space-y-5">
    <ManagementPageHeader title="Nuevo cargo" description="Captura y revisa un cargo de ejemplo para un club o equipo."
      back={{ href: back, label: "Volver a cargos" }} context={[{ label: "Liga", value: seasons[0].league }]} />
    <ChargeDemoNotice capture />
    <ChargeForm seasons={seasons} filters={filters} response={response} />
  </section>;
}
