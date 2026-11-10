import {z} from "zod";
export const documentReviewSchema=z.strictObject({
  operationKey:z.uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),documentId:z.uuid(),
  decision:z.enum(["APPROVE","CORRECTIONS_REQUIRED"]),reason:z.string().trim().min(10).max(800),
  identityChecked:z.boolean(),relationshipChecked:z.boolean(),signatureChecked:z.boolean(),authorizationChecked:z.boolean(),
  guardianName:z.string().trim().min(3).max(160).optional(),relationship:z.enum(["MOTHER","FATHER","GUARDIAN"]).optional(),
});
