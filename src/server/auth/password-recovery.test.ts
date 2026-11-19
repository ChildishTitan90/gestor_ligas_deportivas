import assert from "node:assert/strict";
import test from "node:test";
import { recoveryPolicy } from "./password-recovery";
import { recoveryCompletionSchema, recoveryRequestSchema } from "@/features/auth/schemas";

test("recovery stays off without an explicit and valid deployment policy", () => {
  assert.equal(recoveryPolicy({}), null);
  const env = { PASSWORD_RECOVERY_ENABLED: "true", PASSWORD_RECOVERY_TTL_MINUTES: "15", PASSWORD_RECOVERY_MAX_PER_HOUR: "2" };
  assert.deepEqual(recoveryPolicy(env), { ttlMs: 900_000, maxPerHour: 2 });
  for (const ttl of ["", "0", "61", "3.5", " 15"]) assert.equal(recoveryPolicy({ ...env, PASSWORD_RECOVERY_TTL_MINUTES: ttl }), null);
  assert.equal(recoveryPolicy({ ...env, PASSWORD_RECOVERY_MAX_PER_HOUR: "0" }), null);
});

test("recovery accepts only email and enforces the shared password policy and confirmation", () => {
  assert.deepEqual(recoveryRequestSchema.parse({ email: " DEMO@example.test " }), { email: "demo@example.test" });
  assert.equal(recoveryRequestSchema.safeParse({ email: "demo" }).success, false);
  const valid = { token: "a".repeat(43), newPassword: "Synthetic!123", confirmPassword: "Synthetic!123" };
  assert.equal(recoveryCompletionSchema.safeParse(valid).success, true);
  for (const invalid of [{ token: "invalid" }, { confirmPassword: "Different!123" }, { newPassword: "weak", confirmPassword: "weak" }])
    assert.equal(recoveryCompletionSchema.safeParse({ ...valid, ...invalid }).success, false);
});
