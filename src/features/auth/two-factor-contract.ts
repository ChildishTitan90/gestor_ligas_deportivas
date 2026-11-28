import { z } from "zod";
const proof = z.strictObject({
  method: z.enum(["totp", "backup"]),
  code: z.string().min(1).max(64),
});
export const twoFactorCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({
    action: z.literal("begin"),
    password: z.string().min(1).max(1024),
    proof: proof.optional(),
    revision: z.number().int().min(0),
  }),
  z.strictObject({
    action: z.literal("confirm"),
    operation: z.uuid(),
    code: z.string().max(64),
    revision: z.number().int().min(0),
  }),
  z.strictObject({
    action: z.literal("cancel"),
    operation: z.uuid(),
    revision: z.number().int().min(0),
  }),
  z.strictObject({ action: z.literal("verify"), code: z.string().max(64) }),
  z.strictObject({ action: z.literal("recover"), code: z.string().max(64) }),
  z.strictObject({
    action: z.literal("disable"),
    password: z.string().min(1).max(1024),
    proof,
    revision: z.number().int().min(0),
  }),
]);
export type TwoFactorCommand = z.infer<typeof twoFactorCommand>;
export type TwoFactorResult = {
  code: string;
  status: number;
  revision?: number;
  active?: boolean;
  eligible?: boolean;
  pending?: boolean;
  expiresAt?: string;
  remainingCodes?: number;
  operation?: string;
  secret?: string;
  uri?: string;
  codes?: string[];
  retryAt?: string;
};
