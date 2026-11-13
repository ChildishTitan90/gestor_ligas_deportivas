import { z } from "zod";

export const bodyNames = ["Asamblea General", "Consejo Directivo", "Comité Ejecutivo"] as const;
export const periodFilters = ["all", "current", "past", "future"] as const;
const id = z.uuid();
const optionalId = z.union([id, z.literal("")]);
const date = z.iso.date();
const optionalDate = z.union([date, z.literal("")]);
const reason = z.string().trim().min(3).max(300);

export const governanceMutation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("initialize"), leagueId: id, reason }),
  z.object({ operation: z.literal("position"), leagueId: id, bodyId: id,
    name: z.string().trim().min(1).max(120), roleId: optionalId, reason }),
  z.object({ operation: z.literal("appoint"), leagueId: id, positionId: id, requestId: id,
    personId: id, startsAt: date, endsAt: optionalDate, reason })
    .refine(data => !data.endsAt || data.startsAt <= data.endsAt),
  z.object({ operation: z.literal("finish"), leagueId: id, appointmentId: id,
    endsAt: date, expectedEnd: optionalDate, reason }),
]);

export function dateInLeague(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function canFinishOn(starts: string, currentEnd: string, proposedEnd: string, today: string) {
  return proposedEnd >= starts && (!currentEnd || (currentEnd >= today && proposedEnd < currentEnd));
}
