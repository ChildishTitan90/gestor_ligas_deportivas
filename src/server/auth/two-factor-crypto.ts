import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const MFA_STEP_MS = 30_000;
export const MFA_PENDING_MS = 10 * 60_000;
export const MFA_LOCK_MS = 15 * 60_000;

export function encodeMfaSecret(bytes: Buffer): string {
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decodeSecret(secret: string) {
  if (!/^[A-Z2-7]+$/.test(secret)) throw Error("INVALID_MFA_SECRET");
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function newMfaSecret() {
  return encodeMfaSecret(randomBytes(20));
}
/** RFC 6238 / HOTP HMAC-SHA1. Counter is 64 bits, including dates after 2038. */
export function totpAt(secret: string, step: number, digits = 6) {
  if (!Number.isSafeInteger(step) || step < 0 || ![6, 8].includes(digits))
    throw Error("INVALID_MFA_COUNTER");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeSecret(secret))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1] & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, "0");
}
/** Persist returned step in the SAME transaction as its effect. */
export function matchTotp(
  secret: string,
  code: string,
  now: Date,
  lastStep: bigint | null,
) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now.getTime() / MFA_STEP_MS);
  if (!Number.isSafeInteger(current) || current < 1) return null;
  let matched: bigint | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (
      timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(code)) &&
      (lastStep === null || BigInt(step) > lastStep)
    )
      matched = BigInt(step);
  }
  return matched;
}
export function recoveryCodeHash(userId: string, code: string) {
  return createHash("sha256")
    .update(`pdgld-mfa-v1:${userId}:${code}`)
    .digest("hex");
}
export function newRecoveryCodes(userId: string) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"),
  );
  return { codes, hashes: codes.map((code) => recoveryCodeHash(userId, code)) };
}
function encryptionKey(value = process.env.MFA_ENCRYPTION_KEY) {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value))
    throw Error("MFA_KEY_UNAVAILABLE");
  return Buffer.from(value, "hex");
}
/** Dedicated 256-bit key. AAD binds ciphertext to owner and pending/active purpose. */
export function sealMfaSecret(secret: string, owner: string, key?: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(key), nonce);
  cipher.setAAD(Buffer.from(owner));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function openMfaSecret(sealed: string, owner: string, key?: string) {
  const [version, nonce, tag, ciphertext, extra] = sealed.split(".");
  if (version !== "v1" || !nonce || !tag || !ciphertext || extra)
    throw Error("INVALID_MFA_CIPHERTEXT");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(key),
    Buffer.from(nonce, "base64url"),
  );
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
export function mfaFailure(
  attempts: number,
  blockedUntil: Date | null,
  now: Date,
) {
  if (blockedUntil && blockedUntil > now) return { attempts, blockedUntil };
  const next = (blockedUntil ? 0 : attempts) + 1;
  return {
    attempts: next,
    blockedUntil: next >= 5 ? new Date(now.getTime() + MFA_LOCK_MS) : null,
  };
}
