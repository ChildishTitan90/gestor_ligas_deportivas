import { z } from "zod";

export const curpCheckOutcomes = ["VERIFIED", "NOT_FOUND", "DISCREPANCY", "INVALID_CREDENTIALS",
  "INSUFFICIENT_BALANCE", "UNAVAILABLE", "UNEXPECTED_RESPONSE", "UNCERTAIN", "STALE"] as const;
export type CurpCheckOutcome = typeof curpCheckOutcomes[number];
export type CurpCheckStatus = CurpCheckOutcome | "PENDING" | "NOT_PERFORMED" | "NOT_CONFIGURED";
export const identityFields = ["curp", "firstName", "paternalSurname", "maternalSurname", "birthDate"] as const;
export type CurpMismatch = typeof identityFields[number];
export type CurpProviderResult = { status: CurpCheckOutcome; mismatchedFields: CurpMismatch[] };
export type CurpVerificationStatus = {
  registrationStatus?:string;
  identityReviewStatus?:string|null;
  registrationId: string;
  identityVersion: number;
  checkId: string | null;
  status: CurpCheckStatus;
  mismatchedFields: CurpMismatch[];
  checkedAt: string | null;
  replayed: boolean;
};

/** Una intención explícita por consulta; reenviar la misma clave recupera su resultado. */
export const curpVerificationRequestSchema = z.strictObject({
  operationKey: z.uuid(),
  identityVersion: z.number().int().positive(),
  confirmCharge: z.literal(true),
  retryOf: z.uuid().optional(),
  acknowledgePossiblePreviousCharge: z.boolean().optional(),
});
