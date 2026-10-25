import { z } from "zod";
import { affiliationSubmissionSchema } from "./affiliation-submission";

export const reviewVersionSchema = z.number().int().nonnegative().max(2147483646);
export const affiliationReviewSchema = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("APPROVE"), expectedVersion: reviewVersionSchema }),
  z.strictObject({ decision: z.literal("REQUEST_CORRECTIONS"), expectedVersion: reviewVersionSchema,
    observations: z.string().trim().min(1).max(2000) }),
]);
export const affiliationResubmissionSchema = affiliationSubmissionSchema.extend({ expectedVersion: reviewVersionSchema });
export const affiliationListSchema = z.strictObject({
  leagueId: z.uuid(), clubId: z.uuid().optional(), seasonId: z.uuid().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export function affiliationReviewPhase(status: string, reason: string | null) {
  return status === "PENDING" ? (reason ? "CORRECTIONS_REQUESTED" : "AWAITING_REVIEW") : status;
}
