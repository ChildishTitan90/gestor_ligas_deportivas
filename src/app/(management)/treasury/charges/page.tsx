import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ActionLink } from "@/components/ui/action-link";
import { ChargeAccessDenied } from "@/features/billing/components/charge-access-denied";
import { ChargeList } from "@/features/billing/components/charge-list";
import { chargesPath, chargesUrl, type BillingQuery } from "@/features/billing/navigation";
import { getChargeList } from "@/features/billing/server/queries";
import { billingPageQuery } from "@/features/billing/server/page-access";
import { SelectField } from "@/components/ui/select-field";
import { ChargeOperationControl } from "@/features/billing/components/charge-operation-control";
import { chargeConceptLabels } from "@/features/billing/schemas";
import { formatChargeAmount, formatChargePeriod } from "@/features/billing/presentation";

export const metadata = { title: "Cargos de tesorería" };

export default async function ChargeListPage({ searchParams }: { searchParams: Promise<BillingQuery> }) {
  const query = await searchParams;
  const workspace = await billingPageQuery(() => getChargeList(query));
  if (!workspace) return <ChargeAccessDenied />;
  const { filters, season, charges, league, canCreate, seasons, leagues, plans, total, page } = workspace;
  const context = league ? [{ label: "Liga", value: league }] : [];
  if (season) context.push({ label: "Temporada", value: season.name });
  return <section className="mx-auto max-w-6xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-72">
        <ManagementPageHeader title="Cargos" description="Consulta cargos de clubes y equipos por temporada y periodo."
          back={{ href: "/access", label: "Volver al panel" }} context={context} />
      </div>
      {canCreate && <ActionLink className="sm:mt-[3.125rem]" href={chargesUrl(`${chargesPath}/new`, filters)}>Nuevo cargo</ActionLink>}
    </div>
    {leagues.length > 1 && <form method="get" className="flex flex-wrap items-end gap-3">
      <label className="min-w-60 flex-1 text-sm">Liga<SelectField name="league" defaultValue={league ?? ""} required options={leagues.map(value => ({ value, label: value }))} /></label>
      <button className="primary-action min-h-12 rounded-xl px-5 font-semibold">Consultar liga</button>
    </form>}
    {league ? <>
      <ChargeList filters={filters} charges={charges} seasons={seasons} total={total} page={page} />
      {plans.length > 0 && <section aria-labelledby="billing-plans" className="space-y-3">
        <h2 id="billing-plans" className="text-lg font-semibold text-primary">Planes semanales</h2>
        <p className="text-sm text-muted">Cada plan requiere generar sus periodos. Los cargos confirmados aparecen en el listado.</p>
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {plans.map(plan => <li key={plan.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 text-sm"><h3 className="font-semibold text-primary">{plan.recipient.name} · {chargeConceptLabels[plan.concept]}</h3>
              <p className="mt-1 text-muted">{plan.season.name} · {formatChargeAmount(plan.amount, "MXN")} por periodo</p>
              <p className="mt-1 text-muted">{plan.periodEnd ? formatChargePeriod(plan.periodStart, plan.periodEnd) : plan.periodStart}</p>
            </div>
            {plan.canGenerate && <ChargeOperationControl plan={plan} />}
          </li>)}
        </ul>
      </section>}
    </> : <p role="status">Selecciona una liga para consultar sus cargos.</p>}
  </section>;
}
