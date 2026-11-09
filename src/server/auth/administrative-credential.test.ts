import assert from "node:assert/strict";
import test from "node:test";
import { canUseAdministrativeCredential, generateAdministrativeCredential } from "./administrative-credential";
import { administrativeResetSchema } from "@/features/accounts/administrative-reset-contract";

test("credencial administrativa expira en el límite y no puede reutilizarse", () => {
  const now = new Date(1000);
  const user = { admin_reset_expires_at: new Date(1001), admin_reset_consumed_at: null };
  assert.equal(canUseAdministrativeCredential(user, now), true);
  assert.equal(canUseAdministrativeCredential(user, new Date(1001)), false);
  assert.equal(canUseAdministrativeCredential({ ...user, admin_reset_consumed_at: now }, now), false);
  assert.equal(canUseAdministrativeCredential({ ...user, admin_reset_expires_at: null }, now), true);
  const credential = generateAdministrativeCredential();
  assert.equal(Buffer.from(credential, "base64url").length, 32);
  assert.notEqual(credential, generateAdministrativeCredential());
});

test("reset exige verificación explícita y no acepta un destino aportado por el cliente", () => {
  const valid = { expectedRevision: 0, confirmed: true, identityVerified: true,
    verificationMethod: "IN_PERSON", reason: "Identidad comprobada presencialmente" };
  assert.equal(administrativeResetSchema.safeParse(valid).success, true);
  assert.equal(administrativeResetSchema.safeParse({ ...valid, identityVerified: false }).success, false);
  assert.equal(administrativeResetSchema.safeParse({ ...valid, email: "other@example.test" }).success, false);
});
