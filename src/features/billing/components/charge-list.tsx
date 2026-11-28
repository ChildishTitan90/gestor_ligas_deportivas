import Link from "next/link";
import { SelectField } from "@/components/ui/select-field";
import { ActionLink } from "@/components/ui/action-link";
import { chargesPath, chargesUrl } from "../navigation";
import { chargeConceptLabels } from "../schemas";
import { chargePaymentLabel, formatChargeAmount, formatChargeDate, formatChargePeriod, recipientContext } from "../presentation";
import type { BillingSeason, ChargeFilters, ChargeSummary } from "../types";

const all = { value: "", label: "Todos" };
const textLink = "inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary-hover";

export function ChargeList({ filters, charges, seasons, total, page }: {
  filters: ChargeFilters; charges: readonly ChargeSummary[]; seasons: readonly BillingSeason[]; total: number; page: number;
}) {
  const recipients = [...new Map(seasons.flatMap(season => season.recipients).map(recipient => [recipient.id, recipient])).values()];
  const filterFields = [
    { name: "season", label: "Temporada", value: filters.season, options: seasons.map(season => ({ value: season.id, label: season.name })) },
    { name: "recipient", label: "Destinatario", value: filters.recipient, options: recipients.map(recipient => ({ value: recipient.id, label: recipient.name, description: recipientContext(recipient) })) },
    { name: "concept", label: "Concepto", value: filters.concept, options: Object.entries(chargeConceptLabels).map(([value, label]) => ({ value, label })) },
  ];
  const filtered = Object.values(filters).some(Boolean);

  return <>
    <form method="get" action={chargesPath} className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="Filtros de cargos">
      {filters.league && <input type="hidden" name="league" value={filters.league} />}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {filterFields.map(({ name, label, value, options }) => <div key={name} className="min-w-0">
          <label htmlFor={`charge-filter-${name}`} className="mb-1.5 block text-sm font-medium text-primary">{label}</label>
          <SelectField id={`charge-filter-${name}`} name={name} defaultValue={value ?? ""} options={[all, ...options]} searchable={name === "recipient"} />
        </div>)}
        <div className="min-w-0">
          <label htmlFor="charge-filter-period" className="mb-1.5 block text-sm font-medium text-primary">Mes del periodo</label>
          <input id="charge-filter-period" type="month" name="period" defaultValue={filters.period ?? ""}
            className="min-h-12 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-sm text-primary" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="min-h-12 rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-primary hover:bg-background">Aplicar filtros</button>
        {filtered && <Link href={chargesPath} className={textLink}>Limpiar filtros</Link>}
      </div>
    </form>

    <section aria-labelledby="charge-results" className="space-y-3">
      <h2 id="charge-results" className="text-lg font-semibold text-primary">
        {total} {total === 1 ? "cargo" : "cargos"}
      </h2>
      {charges.length === 0 ? <div className="space-y-3 rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h3 className="font-semibold text-primary">No hay coincidencias para estos filtros</h3>
        <p className="text-sm text-muted">Cambia la temporada, el destinatario, el concepto o el mes para ampliar la búsqueda.</p>
        <ActionLink variant="secondary" href={chargesPath}>Ver todos los cargos</ActionLink>
      </div> : <>
        <div className="hidden rounded-2xl border border-border bg-surface xl:block">
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">Cargos autorizados</caption>
            <thead className="border-b border-border text-xs font-semibold text-muted">
              <tr>
                <th scope="col" className="w-[25%] px-4 py-3">Destinatario</th>
                <th scope="col" className="w-[18%] px-3 py-3">Concepto</th>
                <th scope="col" className="w-[24%] px-3 py-3">Periodo y vencimiento</th>
                <th scope="col" className="w-[20%] px-3 py-3">Importe y saldo</th>
                <th scope="col" className="px-3 py-3"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {charges.map(charge => <tr key={charge.id}>
                <th scope="row" className="px-4 py-4 align-top font-normal">
                  <Recipient charge={charge} />
                </th>
                <td className="px-3 py-4 align-top"><Concept charge={charge} /></td>
                <td className="px-3 py-4 align-top"><Dates charge={charge} /></td>
                <td className="px-3 py-4 align-top"><Amounts charge={charge} /></td>
                <td className="px-3 py-3 text-right align-top"><DetailLink charge={charge} filters={filters} /></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <ul role="list" className="divide-y divide-border rounded-2xl border border-border bg-surface xl:hidden">
          {charges.map(charge => <li key={charge.id} className="space-y-3 p-4 text-sm">
            <Recipient charge={charge} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <div><Concept charge={charge} /></div>
              <div><Amounts charge={charge} /></div>
              <div className="col-span-2"><Dates charge={charge} /></div>
            </div>
            <DetailLink charge={charge} filters={filters} />
          </li>)}
        </ul>
      </>}
      {total > 25 && <nav aria-label="Páginas de cargos" className="flex flex-wrap items-center gap-3">
        {page > 1 && <ActionLink variant="secondary" href={chargesUrl(chargesPath, { ...filters, page: String(page - 1) })}>Anterior</ActionLink>}
        <p className="text-sm text-muted">Página {page}</p>
        {page * 25 < total && <ActionLink variant="secondary" href={chargesUrl(chargesPath, { ...filters, page: String(page + 1) })}>Siguiente</ActionLink>}
      </nav>}
    </section>
  </>;
}

function Recipient({ charge }: { charge: ChargeSummary }) {
  return <>
    <p className="wrap-anywhere font-semibold text-primary">{charge.recipient.name}</p>
    <p className="mt-1 wrap-anywhere text-xs leading-5 text-muted">{recipientContext(charge.recipient)}<br />{charge.season.name}</p>
  </>;
}

function Concept({ charge }: { charge: ChargeSummary }) {
  return <>
    <p className="font-medium text-primary">{chargeConceptLabels[charge.concept]}</p>
    <p className="mt-1 text-xs text-muted">{charge.automation?.label ?? (charge.frequency === "ONCE" ? "Único" : "Semanal")}</p>
  </>;
}

function Dates({ charge }: { charge: ChargeSummary }) {
  return <>
    <p className="text-primary">{formatChargePeriod(charge.periodStart, charge.periodEnd)}</p>
    <p className="mt-1 text-xs text-muted">Vence el {formatChargeDate(charge.dueOn)}</p>
  </>;
}

function Amounts({ charge }: { charge: ChargeSummary }) {
  return <>
    <p className="wrap-anywhere font-semibold text-primary tabular-nums">{formatChargeAmount(charge.amount, charge.currency)}</p>
    {charge.payment && <p className="mt-1 wrap-anywhere text-xs text-muted tabular-nums">Saldo {formatChargeAmount(charge.payment.balance, charge.currency)}</p>}
    <p className="mt-1 text-xs text-muted">{chargePaymentLabel(charge.payment)}</p>
  </>;
}

function DetailLink({ charge, filters }: { charge: ChargeSummary; filters: ChargeFilters }) {
  return <Link className={textLink} href={chargesUrl(`${chargesPath}/${charge.id}`, filters)}
    aria-label={`Ver detalle de ${chargeConceptLabels[charge.concept]} para ${charge.recipient.name}`}>Ver detalle</Link>;
}
