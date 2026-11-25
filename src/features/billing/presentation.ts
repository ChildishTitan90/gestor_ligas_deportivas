import type { ChargeRecipient, ChargeSummary } from "./types";

const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
const timestampFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });
const digits = new Intl.NumberFormat("es-MX");
const rangeFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const formatChargeDate = (date: string) => dateFormat.format(new Date(date));
export const formatChargeMonth = (month: string) => monthFormat.format(new Date(`${month}-01T00:00:00Z`));
export const formatChargeTime = (time: string) => timestampFormat.format(new Date(time));
export const formatChargePeriod = (start: string, end: string) => rangeFormat.formatRange(new Date(start), new Date(end));

export function formatChargeAmount(amount: string, currency: ChargeSummary["currency"]) {
  const [whole, decimals] = amount.split(".");
  return `${currency} ${digits.format(BigInt(whole))}.${decimals}`;
}

export function recipientContext(recipient: ChargeRecipient) {
  return recipient.kind === "CLUB" ? "Club" : `Equipo · ${recipient.category} · ${recipient.club}`;
}

export function chargePaymentLabel(payment: ChargeSummary["payment"]) {
  if (!payment) return "Saldo no disponible";
  if (payment.paid === "0.00") return "Sin pagos registrados";
  return payment.balance === "0.00" ? "Pago total" : "Pago parcial";
}
