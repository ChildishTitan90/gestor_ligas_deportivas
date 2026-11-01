import { z } from "zod";

export const ineOutcomes = ["IDENTITY_VERIFIED", "PROVIDER_PASSED", "ADMIN_REVIEW_REQUIRED", "INVALID_CREDENTIALS", "INSUFFICIENT_BALANCE", "UNAVAILABLE", "UNCERTAIN", "STALE", "STORAGE_FAILED"] as const;
export const ineParts = ["front", "back", "selfie"] as const;
export const ineIntentSchema = z.strictObject({
  operationKey: z.uuid(), identityVersion: z.number().int().positive(),
  acknowledgeCharge: z.literal(true), retryOf: z.uuid().nullable(), acknowledgePossiblePreviousCharge: z.boolean(),
});
export const ineStatusSchema = z.object({
  registrationId: z.uuid(), applicable: z.boolean(), canSubmit: z.boolean(), identityVersion: z.number().int(),
  attemptId: z.uuid().nullable(), status: z.enum(["NOT_STARTED", "PENDING", ...ineOutcomes]),
  approvalAllowed: z.literal(false),
});
export type IneStatus = z.infer<typeof ineStatusSchema>;
export type IneOutcome = typeof ineOutcomes[number];
