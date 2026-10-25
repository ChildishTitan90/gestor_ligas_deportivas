import assert from "node:assert/strict";
import test from "node:test";
import {
  createSignatureUploadTicket,
  verifySignatureUploadTicket,
  SignatureUploadTicketError,
} from "./signature-upload-ticket";

const secret = "secreto-sintetico-exclusivo-para-pruebas-PDGLD59";
const now = Date.UTC(2026, 9, 24, 12, 0, 0);

function context() {
  return {
    actorId: "550e8400-e29b-41d4-a716-446655440001",
    clubId: "550e8400-e29b-41d4-a716-446655440002",
    seasonId: "550e8400-e29b-41d4-a716-446655440003",
    fileId: "550e8400-e29b-41d4-a716-446655440004",
    office: "PRESIDENT",
    mimeType: "image/png",
    sizeBytes: 100,
  };
}

function invalid(error: unknown): boolean {
  return (
    error instanceof SignatureUploadTicketError &&
    error.code === "INVALID_UPLOAD_TICKET" &&
    error.status === 403
  );
}

test("acepta un comprobante válido y conserva su contexto", () => {
  const input = context();
  const token = createSignatureUploadTicket(input, secret, now);

  const claims = verifySignatureUploadTicket(
    token,
    input.actorId,
    secret,
    now,
  );

  assert.deepEqual(claims, {
    ...input,
    expiresAt: Math.floor(now / 1000) + 900,
  });
});

test("rechaza cambiar el club o cargo sin una nueva firma", () => {
  const input = context();
  const token = createSignatureUploadTicket(input, secret, now);
  const [payload, signature] = token.split(".");
  const original = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  );

  for (const change of [
    { clubId: "550e8400-e29b-41d4-a716-446655440099" },
    { office: "TREASURER" },
  ]) {
    const modified = Buffer.from(
      JSON.stringify({ ...original, ...change }),
    ).toString("base64url");

    assert.throws(
      () => verifySignatureUploadTicket(
        `${modified}.${signature}`,
        input.actorId,
        secret,
        now,
      ),
      invalid,
    );
  }
});

test("rechaza usar el comprobante con otro usuario", () => {
  const token = createSignatureUploadTicket(context(), secret, now);

  assert.throws(
    () => verifySignatureUploadTicket(
      token,
      "550e8400-e29b-41d4-a716-446655440099",
      secret,
      now,
    ),
    invalid,
  );
});

test("acepta antes del vencimiento y rechaza el límite exacto", () => {
  const input = context();
  const token = createSignatureUploadTicket(input, secret, now);

  assert.doesNotThrow(() =>
    verifySignatureUploadTicket(
      token,
      input.actorId,
      secret,
      now + 899_999,
    ),
  );

  assert.throws(
    () => verifySignatureUploadTicket(
      token,
      input.actorId,
      secret,
      now + 900_000,
    ),
    invalid,
  );
});

test("rechaza comprobantes malformados", () => {
  for (const token of ["", "sin-punto", "a.b.c", "a.b", "!.!"]) {
    assert.throws(
      () => verifySignatureUploadTicket(
        token,
        context().actorId,
        secret,
        now,
      ),
      invalid,
    );
  }
});

test("rechaza verificar con un secreto diferente", () => {
  const input = context();
  const token = createSignatureUploadTicket(input, secret, now);

  assert.throws(
    () => verifySignatureUploadTicket(
      token,
      input.actorId,
      "otro-secreto-sintetico-distinto-para-pruebas",
      now,
    ),
    invalid,
  );
});

test("no emite comprobantes con un secreto demasiado corto", () => {
  assert.throws(
    () => createSignatureUploadTicket(context(), "corto", now),
    /SIGNATURE_SIGNING_NOT_CONFIGURED/,
  );
});