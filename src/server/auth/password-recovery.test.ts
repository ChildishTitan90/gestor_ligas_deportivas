import assert from "node:assert/strict";
import test from "node:test";
import { recoveryPolicy } from "./password-recovery";
import { recoveryCompletionSchema, recoveryRequestSchema } from "@/features/auth/schemas";

test("recovery stays off without an explicit and valid deployment policy", () => {
  assert.equal(recoveryPolicy({}), null);
  const env = { NEXTAUTH_URL:"http://127.0.0.1:3032", NODE_ENV:"development", PASSWORD_RECOVERY_CLIENT_IP_MODE:"local",
    PASSWORD_RECOVERY_RATE_WINDOW_SECONDS:"60", PASSWORD_RECOVERY_REQUESTS_PER_IP:"10", PASSWORD_RECOVERY_COMPLETIONS_PER_IP:"10",
    PASSWORD_RECOVERY_REQUESTS_GLOBAL:"100", PASSWORD_RECOVERY_COMPLETIONS_GLOBAL:"100", PASSWORD_RECOVERY_RATE_SECRET:"synthetic-abuse-secret-at-least-32-characters", PASSWORD_RECOVERY_ENABLED: "true", PASSWORD_RECOVERY_TTL_MINUTES: "15", PASSWORD_RECOVERY_MAX_PER_HOUR: "2" };
  assert.equal(recoveryPolicy(env)?.ttlMs, 900_000);
  assert.equal(recoveryPolicy(env)?.maxPerHour, 2);
  assert.equal(recoveryPolicy({...env,PASSWORD_RECOVERY_RATE_SECRET:""}),null);
  assert.equal(recoveryPolicy({...env,PASSWORD_RECOVERY_REQUESTS_GLOBAL:"0"}),null);
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

test("HTTPS local admite la política aprobada solo en desarrollo y loopback", async () => {
  const { resendConfiguration } = await import("../email/resend");
  const env = { NEXTAUTH_URL: "https://127.0.0.1:34432", NODE_ENV: "development",
    PASSWORD_RECOVERY_ENABLED: "true", PASSWORD_RECOVERY_TTL_MINUTES: "15", PASSWORD_RECOVERY_MAX_PER_HOUR: "3",
    PASSWORD_RECOVERY_RATE_WINDOW_SECONDS: "60", PASSWORD_RECOVERY_REQUESTS_PER_IP: "5", PASSWORD_RECOVERY_COMPLETIONS_PER_IP: "10",
    PASSWORD_RECOVERY_REQUESTS_GLOBAL: "50", PASSWORD_RECOVERY_COMPLETIONS_GLOBAL: "100", PASSWORD_RECOVERY_CLIENT_IP_MODE: "local",
    PASSWORD_RECOVERY_RATE_SECRET: "synthetic-private-secret-for-local-policy-test",
    ACCOUNT_EMAIL_ENABLED: "true", ACCOUNT_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "synthetic-no-network", ACCOUNT_EMAIL_FROM: "sender@example.test" };
  assert.ok(recoveryPolicy(env));
  assert.ok(resendConfiguration(env));
  assert.equal(recoveryPolicy({ ...env, NODE_ENV: "production" }), null);
  assert.equal(recoveryPolicy({ ...env, NEXTAUTH_URL: "https://public.example.test" }), null);
  assert.equal(recoveryPolicy({ ...env, VERCEL: "1" }), null);
  assert.equal(resendConfiguration({ ...env, NEXTAUTH_URL: "http://127.0.0.1:34432" }), null);
});
