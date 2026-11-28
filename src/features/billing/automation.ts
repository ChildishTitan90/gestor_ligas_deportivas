import { z } from "zod";
import { chargeAmountSchema } from "./schemas";

export const automationLabels = {
  CLUB_AFFILIATION: "Afiliación aprobada del club",
  TEAM_ENROLLMENT: "Inscripción del equipo",
  REFEREE_MATCHDAY: "Arbitraje por jornada programada",
} as const;

export const automationPolicySchema = z.strictObject({
  operationId: z.uuid(), seasonId: z.uuid(),
  kind: z.enum(["CLUB_AFFILIATION", "TEAM_ENROLLMENT", "REFEREE_MATCHDAY"]),
  expectedRevision: z.number().int().nonnegative(), enabled: z.boolean(),
  amount: chargeAmountSchema,
  dueDays: z.number().int().min(0).max(365),
  firstMatchday: z.number().int().min(1).max(1000),
  lastMatchday: z.number().int().min(1).max(1000),
  reason: z.string().trim().min(1).max(2000),
}).refine(value => value.lastMatchday >= value.firstMatchday, {
  path: ["lastMatchday"], message: "La jornada final debe ser igual o posterior a la inicial.",
});
export type AutomationPolicyInput = z.output<typeof automationPolicySchema>;
export type AutomationPolicyView = {
  id: string; seasonId: string; kind: AutomationPolicyInput["kind"]; revision: number;
  enabled: boolean; amount: string; dueDays: number; firstMatchday: number; lastMatchday: number;
};
export type AutomationResult = { status: "CONFIRMED"; policy: AutomationPolicyView }
  | { status: "REJECTED"; code: string } | { status: "UNCERTAIN" };
