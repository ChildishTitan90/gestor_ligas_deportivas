import { z } from "zod";
import { identityFields } from "./curp-verification";
import { isProviderBlocked, providerRetryStateSchema } from "./provider-retry";

export const ineOutcomes = ["IDENTITY_VERIFIED", "PROVIDER_PASSED", "ADMIN_REVIEW_REQUIRED", "INVALID_CREDENTIALS", "INSUFFICIENT_BALANCE", "UNAVAILABLE", "UNCERTAIN", "STALE", "STORAGE_FAILED"] as const;
export const ineParts = ["front", "back", "selfie"] as const;
export const ineIntentSchema = z.strictObject({
  operationKey: z.uuid(), identityVersion: z.number().int().positive(),
  acknowledgeCharge: z.literal(true), retryOf: z.uuid().nullable(), acknowledgePossiblePreviousCharge: z.boolean(),
});
export const ineStatusSchema = z.object({
  ...providerRetryStateSchema.shape,
  registrationId: z.uuid(), applicable: z.boolean(), canSubmit: z.boolean(), identityVersion: z.number().int(),
  attemptId: z.uuid().nullable(), status: z.enum(["NOT_STARTED", "PENDING", ...ineOutcomes]),
  approvalAllowed: z.literal(false),
  missingFields: z.array(z.enum(identityFields)).max(identityFields.length).optional(),
  mismatchedFields: z.array(z.enum(identityFields)).max(identityFields.length).optional(),
});
export type IneStatus = z.infer<typeof ineStatusSchema>;
export type IneOutcome = typeof ineOutcomes[number];
export function canRetryIneVerification(status: IneStatus["status"], providerRetryAuthorized = false) {
  return status === "UNAVAILABLE" || status === "STORAGE_FAILED" || (providerRetryAuthorized && isProviderBlocked(status));
}
