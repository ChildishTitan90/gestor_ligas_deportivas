import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ActionLink } from "@/components/ui/action-link";
import { ChargeAccessDenied, ChargeDemoNotice, ChargeListError } from "@/features/billing/components/charge-demo-state";
import { ChargeList } from "@/features/billing/components/charge-list";
import { chargesPath, chargesUrl, type DemoQuery } from "@/features/billing/demo-data";
import { getChargeDemoList } from "@/features/billing/server/queries";

export const metadata = { title: "Cargos de tesorería" };

export default async function ChargeListPage({ searchParams }: { searchParams: Promise<DemoQuery> }) {
  const workspace = await getChargeDemoList(await searchParams);
  if (!workspace) return <ChargeAccessDenied />;
  const { filters, season, charges, league, canCreate } = workspace;
  const context = [{ label: "Liga", value: league }];
  if (season) context.push({ label: "Temporada", value: season.name });
  return <section className="mx-auto max-w-6xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-72">
        <ManagementPageHeader title="Cargos" description="Consulta cargos de clubes y equipos por temporada y periodo."
          back={{ href: "/access", label: "Volver al panel" }} context={context} />
      </div>
      {canCreate && <ActionLink className="sm:mt-[3.125rem]" href={chargesUrl(`${chargesPath}/new`, filters)}>Nuevo cargo</ActionLink>}
    </div>
    <ChargeDemoNotice />
    {charges ? <ChargeList filters={filters} charges={charges} /> : <ChargeListError />}
  </section>;
}
