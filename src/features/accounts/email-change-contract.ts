import { z } from "zod";
import { emailSchema } from "@/features/auth/schemas";
import { accountStatusSchema } from "./maintenance-contract";

export const emailChangeRequestSchema = z.strictObject({
  email: emailSchema,
  operationKey: z.uuid(),
  // Solicitud y confirmación consumen una revisión cada una.
  expectedRevision: accountStatusSchema.shape.expectedRevision.max(2147483645),
  reason: accountStatusSchema.shape.reason,
  confirmed: accountStatusSchema.shape.confirmed,
});
// Propósito explícito y formato distinto de sid/reset; nunca se acepta como sesión.
export const emailChangeConfirmationSchema = z.strictObject({
  token: z.string().regex(/^ec1_[A-Za-z0-9_-]{43}$/),
});
export type EmailDelivery = "NOT_CONFIGURED" | "PENDING" | "ACCEPTED" | "FAILED" | "UNKNOWN";
export type EmailChangeResult = {
  id: string; status: "PENDING" | "CONFIRMED" | "SUPERSEDED";
  revision: number; expiresAt: string;
  confirmationDelivery: EmailDelivery; previousNoticeDelivery: EmailDelivery;
  completionNoticeDelivery: EmailDelivery;
};
