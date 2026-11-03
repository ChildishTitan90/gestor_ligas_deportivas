import { z } from "zod";
import { playerPolicySchema } from "./schemas";
export type PlayerPolicy = z.infer<typeof playerPolicySchema>;

/** Solo resuelve edad. Documentos, ámbito y aprobación se verifican en servidor. */
export function evaluatePlayerAge(policy: PlayerPolicy, birthDate: string) {
  if (!z.iso.date().safeParse(birthDate).success) return { status: "INVALID_BIRTH_DATE" as const };
  const age = policy.referenceYear - Number(birthDate.slice(0, 4));
  if (age < 0 || (policy.maximumAge !== null && age > policy.maximumAge)) return { status: "OUTSIDE_RANGE" as const, age };
  if (age >= policy.minimumAge) return { status: "ORDINARY_RANGE" as const, age };
  if (policy.exceptionMinimumAge !== null && age >= policy.exceptionMinimumAge) return { status: "REQUIRES_ADMIN_APPROVAL" as const, age };
  return { status: "OUTSIDE_RANGE" as const, age };
}

/** ISO lunes=1 ... domingo=7; no depende de la zona horaria del proceso. */
export function isPlayerRegistrationDay(policy: PlayerPolicy, now: Date) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: policy.timezone, weekday: "short" }).format(now);
  return policy.registrationDays.includes(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(day) + 1);
}
