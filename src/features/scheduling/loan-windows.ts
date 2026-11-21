import { z } from "zod";

// Contrato requested_windows de PDGLD-23; los límites son instantes UTC.
const windowsSchema = z.array(z.strictObject({
  startsAt: z.iso.datetime(), endsAt: z.iso.datetime(),
}).refine(w => Date.parse(w.endsAt) > Date.parse(w.startsAt))).min(1).max(50);

export function parseLoanWindows(value: unknown) {
  const result = windowsSchema.safeParse(value);
  return result.success ? result.data.map(w => ({ start: Date.parse(w.startsAt), end: Date.parse(w.endsAt) })) : [];
}

export function fitsLoanWindow(windows: ReturnType<typeof parseLoanWindows>, start: number, reservedUntil: number) {
  return reservedUntil > start && windows.some(w => start >= w.start && reservedUntil <= w.end);
}
