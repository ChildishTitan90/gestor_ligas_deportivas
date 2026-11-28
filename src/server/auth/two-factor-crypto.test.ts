import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeMfaSecret,
  totpAt,
  matchTotp,
  sealMfaSecret,
  openMfaSecret,
  newRecoveryCodes,
  recoveryCodeHash,
  mfaFailure,
} from "./two-factor-crypto";
const secret = encodeMfaSecret(Buffer.from("12345678901234567890"));
test("RFC 6238 appendix B SHA1 vectors including post-2038", () => {
  for (const [seconds, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const)
    assert.equal(totpAt(secret, Math.floor(seconds / 30), 8), expected);
});
test("exact ±1 window, strict input and monotonic replay protection", () => {
  const step = 50_000,
    now = new Date(step * 30000);
  for (const offset of [-1, 0, 1]) {
    const code = totpAt(secret, step + offset);
    assert.equal(matchTotp(secret, code, now, null), BigInt(step + offset));
    assert.equal(matchTotp(secret, code, now, BigInt(step + offset)), null);
    assert.equal(matchTotp(secret, code, now, BigInt(step + 2)), null);
  }
  for (const offset of [-2, 2])
    assert.equal(
      matchTotp(secret, totpAt(secret, step + offset), now, null),
      null,
    );
  for (const code of ["", "12345", "1234567", " 123456", "１２３４５６"])
    assert.equal(matchTotp(secret, code, now, null), null);
});
test("authenticated encryption rejects substitution, tampering and missing key", () => {
  const key = "a1".repeat(32),
    sealed = sealMfaSecret(secret, "owner:pending", key);
  assert.equal(openMfaSecret(sealed, "owner:pending", key), secret);
  assert.notEqual(sealMfaSecret(secret, "owner:pending", key), sealed);
  assert.throws(() => openMfaSecret(sealed, "other:pending", key));
  assert.throws(() => openMfaSecret(sealed, "owner:active", key));
  assert.throws(() => openMfaSecret(sealed, "owner:pending", "b2".repeat(32)));
  assert.throws(() => sealMfaSecret(secret, "owner", "bad"));
});
test("ten high entropy recovery codes; hashes are owner bound", () => {
  const { codes, hashes } = newRecoveryCodes("synthetic-owner");
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  codes.forEach((code, i) => {
    assert.match(code, /^[a-f0-9]{8}(-[a-f0-9]{8}){3}$/);
    assert.equal(hashes[i], recoveryCodeHash("synthetic-owner", code));
    assert.notEqual(hashes[i], recoveryCodeHash("other", code));
  });
});
test("five failures block fifteen minutes; attempts during block do not extend it", () => {
  const now = new Date(1000000);
  let state: { attempts: number; blockedUntil: Date | null } = {
    attempts: 0,
    blockedUntil: null,
  };
  for (let n = 1; n <= 5; n++) {
    state = mfaFailure(state.attempts, state.blockedUntil, now);
    assert.equal(state.attempts, n);
  }
  assert.equal(state.blockedUntil!.getTime(), now.getTime() + 900000);
  assert.deepEqual(
    mfaFailure(state.attempts, state.blockedUntil, new Date(now.getTime() + 1)),
    state,
  );
  assert.deepEqual(
    mfaFailure(state.attempts, state.blockedUntil, state.blockedUntil!),
    { attempts: 1, blockedUntil: null },
  );
});
