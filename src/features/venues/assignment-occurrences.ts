import { venueTimeToIso } from "./time";

/** Expande un periodo de localía en la zona de la liga, sin convertir horas ambiguas. */
export function assignmentOccurrences(from: string, through: string, weekday: number, time: string, zone: string): Date[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through) ||
      !/^\d{2}:\d{2}$/.test(time) || !Number.isInteger(weekday) || weekday < 1 || weekday > 7)
    throw new Error("INVALID_ASSIGNMENT_PERIOD");
  const start = new Date(`${from}T00:00:00Z`), end = new Date(`${through}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.toISOString().slice(0, 10) !== from ||
      end.toISOString().slice(0, 10) !== through || end < start || end.getTime() - start.getTime() > 366 * 86400000)
    throw new Error("INVALID_ASSIGNMENT_PERIOD");
  const occurrences: Date[] = [];
  for (let day = start.getTime(); day <= end.getTime(); day += 86400000) {
    const date = new Date(day);
    if ((date.getUTCDay() || 7) !== weekday) continue;
    const iso = venueTimeToIso(`${date.toISOString().slice(0, 10)}T${time}`, zone);
    if (!iso) throw new Error("INVALID_ASSIGNMENT_TIME");
    occurrences.push(new Date(iso));
  }
  if (!occurrences.length) throw new Error("EMPTY_ASSIGNMENT_PERIOD");
  return occurrences;
}
