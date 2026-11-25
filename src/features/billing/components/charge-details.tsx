import { chargeConceptLabels } from "../schemas";
import { chargePaymentLabel, formatChargeAmount, formatChargeDate, formatChargePeriod, formatChargeTime, recipientContext } from "../presentation";
import type { ChargeDetail, ChargeTerms as Terms } from "../types";

const changeLabels = { CREATED: "Cargo creado", UPDATED: "Cargo modificado", VOIDED: "Cargo cancelado" };

export function ChargeTerms({ terms, preview = false }: { terms: Terms; preview?: boolean }) {
  const weekly = terms.frequency === "WEEKLY";
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm sm:gap-x-6">
    <div className="col-span-2 min-w-0 sm:col-span-1">
      <dt className="text-muted">Destinatario</dt>
      <dd className="mt-1 wrap-anywhere text-base font-semibold text-primary">{terms.recipient.name}</dd>
      <dd className="mt-0.5 wrap-anywhere text-muted">{recipientContext(terms.recipient)}</dd>
    </div>
    <div className="col-span-2 min-w-0 sm:col-span-1">
      <dt className="text-muted">{preview && weekly ? "Importe por semana" : "Importe del cargo"}</dt>
      <dd className="mt-1 wrap-anywhere text-lg font-semibold text-primary tabular-nums">{formatChargeAmount(terms.amount, terms.currency)}</dd>
    </div>
    <div>
      <dt className="text-muted">Liga y temporada</dt>
      <dd className="mt-1 font-medium text-primary">{terms.season.league}</dd>
      <dd className="mt-0.5 text-muted">{terms.season.name}</dd>
    </div>
    <div>
      <dt className="text-muted">Concepto y modalidad</dt>
      <dd className="mt-1 font-medium text-primary">{chargeConceptLabels[terms.concept]} · {weekly ? "Semanal" : "Único"}</dd>
    </div>
    <div>
      <dt className="text-muted">{preview && weekly ? "Ventana solicitada" : "Periodo del cargo"}</dt>
      <dd className="mt-1 font-medium text-primary">{formatChargePeriod(terms.periodStart, terms.periodEnd)}</dd>
    </div>
    <div>
      <dt className="text-muted">{preview && weekly ? "Vencimiento de referencia" : "Vencimiento"}</dt>
      <dd className="mt-1 font-medium text-primary">{formatChargeDate(terms.dueOn)}</dd>
    </div>
  </dl>;
}

export function WeeklyConditions() {
  return <div className="rounded-xl border border-border bg-soft px-4 py-3 text-sm leading-6 text-primary">
    <p className="font-semibold">Condiciones de la recurrencia semanal</p>
    <p>Guardar el plan habilita la generación manual de cada periodo de siete días dentro de esta ventana. Tesorería elige las fechas y el vencimiento al generar cada cargo.</p>
  </div>;
}

export function ChargeDetails({ charge }: { charge: ChargeDetail }) {
  return <div className="space-y-5">
    <section aria-labelledby="charge-terms" className="space-y-4 rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 id="charge-terms" className="text-lg font-semibold text-primary">Datos del cargo</h2>
      <ChargeTerms terms={charge} />
      <p className="border-t border-border pt-3 text-sm text-muted">Emitido el {formatChargeDate(charge.issuedOn)} · Versión {charge.version}</p>
      {charge.billingPlanId && <p className="text-sm text-muted">Este cargo proviene de un plan semanal.</p>}
    </section>
    <section aria-labelledby="charge-payment" className="space-y-3 rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 id="charge-payment" className="text-lg font-semibold text-primary">Pagos y saldo</h2>
      <p className="text-sm font-medium text-primary">{chargePaymentLabel(charge.payment)}</p>
      {charge.payment && <dl className="grid grid-cols-2 gap-4 text-sm tabular-nums">
        <div><dt className="text-muted">Pagos registrados</dt><dd className="mt-1 font-semibold text-primary">{formatChargeAmount(charge.payment.paid, charge.currency)}</dd></div>
        <div><dt className="text-muted">Saldo</dt><dd className="mt-1 font-semibold text-primary">{formatChargeAmount(charge.payment.balance, charge.currency)}</dd></div>
      </dl>}
    </section>
    <section aria-labelledby="charge-history" className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 id="charge-history" className="text-lg font-semibold text-primary">Historial de modificaciones</h2>
      {charge.history.length ? <ol role="list" className="mt-1 divide-y divide-border">
        {charge.history.map(entry => <li key={entry.id} className="space-y-1 py-4 last:pb-0">
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
            <h3 className="font-semibold text-primary">{changeLabels[entry.event]}</h3>
            <time dateTime={entry.at} className="text-muted">{formatChargeTime(entry.at)}</time>
          </div>
          <p className="text-xs text-muted">{entry.actorLabel}</p>
          <p className="wrap-anywhere text-sm text-primary"><strong className="font-medium">Motivo:</strong> {entry.reason}</p>
          {entry.change && <p className="wrap-anywhere text-sm text-muted">{entry.change}</p>}
        </li>)}
      </ol> : <p className="mt-2 text-sm text-muted">Todavía no hay movimientos en el historial.</p>}
    </section>
  </div>;
}
