import { z } from "zod";

export const adjustmentInput = z.strictObject({
  proposalId: z.uuid(),
  matchId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  startsAt: z.iso.datetime({ local: true, precision: -1 }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});

export type AdjustmentInput = z.infer<typeof adjustmentInput>;
export const saveAdjustmentInput = adjustmentInput.extend({
  venueId: z.uuid(),
  reason: z.string().trim().min(8).max(500),
});

export const proposalReviewInput = z.strictObject({
  proposalId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  operation: z.enum(["submit", "approve", "return"]),
  reason: z.string().trim().min(8).max(500),
});
