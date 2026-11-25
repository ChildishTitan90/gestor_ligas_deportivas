import { z } from "zod";

export const providerRetryRequestSchema = z.strictObject({
  kind: z.enum(["CURP", "INE"]),
  attemptId: z.uuid(),
  confirmProviderRestored: z.literal(true),
});

export type ProviderRetryKind = z.infer<typeof providerRetryRequestSchema>["kind"];

export const providerRetryStateSchema = z.object({
  providerRetryAuthorized: z.boolean().optional(),
  canAuthorizeProviderRetry: z.boolean().optional(),
});

export type ProviderRetryState = z.infer<typeof providerRetryStateSchema>;

export function isProviderBlocked(status: string) {
  return status === "INVALID_CREDENTIALS" || status === "INSUFFICIENT_BALANCE";
}
