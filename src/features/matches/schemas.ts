import { z } from "zod";

export const matchStatuses = [
  "DRAFT", "SCHEDULED", "CONFIRMED", "IN_PROGRESS", "FINISHED", "UNDER_REVIEW",
  "NO_SHOW", "SUSPENDED", "CANCELED", "RESCHEDULED", "UNSCHEDULED", "ADMINISTRATIVELY_RESOLVED",
] as const;

export const transitionSchema = z.strictObject({
  matchId: z.uuid(),
  operationId: z.uuid(),
  expectedVersion: z.number().int().min(1).max(2147483646),
  toStatus: z.enum(matchStatuses),
  reason: z.string().trim().min(1).max(500),
});
export type TransitionInput = z.infer<typeof transitionSchema>;
