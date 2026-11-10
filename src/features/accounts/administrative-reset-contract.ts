import { z } from "zod";
import { accountStatusSchema } from "./maintenance-contract";

export const administrativeResetSchema = z.strictObject({
  expectedRevision: accountStatusSchema.shape.expectedRevision,
  confirmed: z.literal(true),
  identityVerified: z.literal(true),
  verificationMethod: z.enum(["IN_PERSON", "PREVIOUSLY_REGISTERED_CHANNEL"]),
  reason: accountStatusSchema.shape.reason,
});

export const administrativeResetReceiptSchema = z.object({
  operationId: z.uuid(),
  revision: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
  delivery: z.enum(["ACCEPTED", "FAILED", "UNKNOWN"]),
});
export type AdministrativeResetReceipt = z.infer<typeof administrativeResetReceiptSchema>;
