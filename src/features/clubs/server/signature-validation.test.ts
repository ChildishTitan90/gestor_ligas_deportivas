import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  SIGNATURE_MAX_BYTES,
  SignatureValidationError,
  validateSignatureContent,
} from "./signature-validation";

async function image(format: "png" | "jpeg") {
  return sharp({
    create: {
      width: 20,
      height: 10,
      channels: 3,
      background: "#ffffff",
    },
  }).toFormat(format).toBuffer();
}

async function pdf() {
  const document = await PDFDocument.create();
  document.addPage([200, 100]);
  return document.save();
}

function invalid(error: unknown): boolean {
  return (
    error instanceof SignatureValidationError &&
    error.code === "INVALID_SIGNATURE" &&
    error.status === 400
  );
}

test("acepta PNG y JPEG reales y calcula sus metadatos", async () => {
  for (const format of ["png", "jpeg"] as const) {
    const bytes = await image(format);
    const mimeType = format === "png" ? "image/png" : "image/jpeg";

    const result = await validateSignatureContent(bytes, mimeType);

    assert.equal(result.mimeType, mimeType);
    assert.equal(result.sizeBytes, bytes.byteLength);
    assert.equal(
      result.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    assert.deepEqual(Buffer.from(result.bytes), bytes);
  }
});

test("acepta un PDF real con páginas", async () => {
  const bytes = await pdf();

  const result = await validateSignatureContent(
    bytes,
    "application/pdf",
  );

  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.sizeBytes, bytes.byteLength);
  assert.equal(
    result.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
});

test("rechaza archivos vacíos y superiores al límite", async () => {
  await assert.rejects(
    validateSignatureContent(new Uint8Array(), "image/png"),
    invalid,
  );

  await assert.rejects(
    validateSignatureContent(
      new Uint8Array(SIGNATURE_MAX_BYTES + 1),
      "image/png",
    ),
    (error: unknown) =>
      error instanceof SignatureValidationError &&
      error.code === "SIGNATURE_TOO_LARGE" &&
      error.status === 413,
  );
});

test("rechaza un tipo declarado que no coincide con la imagen", async () => {
  const png = await image("png");

  await assert.rejects(
    validateSignatureContent(png, "image/jpeg"),
    invalid,
  );

  await assert.rejects(
    validateSignatureContent(png, "application/pdf"),
    invalid,
  );
});

test("rechaza texto disfrazado de imagen o PDF", async () => {
  const text = Buffer.from("<html>Esto no es una firma</html>");

  for (const mimeType of [
    "image/png",
    "image/jpeg",
    "application/pdf",
  ]) {
    await assert.rejects(
      validateSignatureContent(text, mimeType),
      invalid,
    );
  }
});

test("rechaza archivos truncados y encabezados PDF falsos", async () => {
  const png = await image("png");

  await assert.rejects(
    validateSignatureContent(png.subarray(0, 20), "image/png"),
    invalid,
  );

  await assert.rejects(
    validateSignatureContent(
      Buffer.from("%PDF-1.7\narchivo roto"),
      "application/pdf",
    ),
    invalid,
  );
});

test("rechaza formatos no admitidos", async () => {
  const png = await image("png");

  await assert.rejects(
    validateSignatureContent(png, "image/svg+xml"),
    invalid,
  );
});

test("el resultado no comparte los bytes mutables del original", async () => {
  const original = await image("png");
  const result = await validateSignatureContent(original, "image/png");
  const firstByte = result.bytes[0];

  original[0] = original[0] ^ 255;

  assert.equal(result.bytes[0], firstByte);
});