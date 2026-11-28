import type { ChargeRecipient, ChargeSummary } from "./types";

const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC", calendar: "gregory", numberingSystem: "latn" });
const monthFormat = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
const timestampFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });
const digits = new Intl.NumberFormat("es-MX");

// Componer las partes evita separadores/espacios de formatRange distintos entre
// ICU (Node) y el navegador durante la hidratación. La fecha civil siempre es UTC.
export const formatChargeDate = (date: string) => {
  const parts = dateFormat.formatToParts(new Date(date));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value;
  return `${part("day")}/${part("month")}/${part("year")}`;
};
export const formatChargeMonth = (month: string) => monthFormat.format(new Date(`${month}-01T00:00:00Z`));
export const formatChargeTime = (time: string) => timestampFormat.format(new Date(time));
export const formatChargePeriod = (start: string, end: string) => start === end ? formatChargeDate(start) : `${formatChargeDate(start)} al ${formatChargeDate(end)}`;

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
