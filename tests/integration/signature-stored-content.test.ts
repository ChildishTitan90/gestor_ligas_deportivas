import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { SignatureStorageFixture } from "./signature-storage.fixture";
import { readAndValidateSignature } from
  "../../src/features/clubs/server/signature-stored-content";
import { SignatureValidationError } from
  "../../src/features/clubs/server/signature-validation";

async function createPng() {
  return sharp({
    create: {
      width: 20,
      height: 10,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  }).png().toBuffer();
}

const invalidSignature = (error: unknown) =>
  error instanceof SignatureValidationError &&
  error.code === "INVALID_SIGNATURE";

test("PDGLD-59: valida los bytes recuperados y calcula sus metadatos", async () => {
  const storage = new SignatureStorageFixture();
  const bytes = await createPng();

  await storage.put("synthetic/valid", {
    bytes,
    mimeType: "image/png",
  });

  const result = await readAndValidateSignature(
    storage,
    "synthetic/valid",
    { mimeType: "image/png", sizeBytes: bytes.length },
  );

  assert.equal(result.mimeType, "image/png");
  assert.equal(result.sizeBytes, bytes.length);
  assert.equal(
    result.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
});

test("PDGLD-59: rechaza un tamaño distinto al autorizado", async () => {
  const storage = new SignatureStorageFixture();
  const bytes = await createPng();

  await storage.put("synthetic/wrong-size", {
    bytes,
    mimeType: "image/png",
  });

  await assert.rejects(
    readAndValidateSignature(storage, "synthetic/wrong-size", {
      mimeType: "image/png",
      sizeBytes: bytes.length + 1,
    }),
    invalidSignature,
  );
});

test("PDGLD-59: rechaza metadatos de almacenamiento inconsistentes", async () => {
  const storage = new SignatureStorageFixture();
  const bytes = await createPng();

  await storage.put("synthetic/wrong-metadata", {
    bytes,
    mimeType: "image/jpeg",
  });

  await assert.rejects(
    readAndValidateSignature(storage, "synthetic/wrong-metadata", {
      mimeType: "image/png",
      sizeBytes: bytes.length,
    }),
    invalidSignature,
  );
});

test("PDGLD-59: rechaza texto almacenado como imagen", async () => {
  const storage = new SignatureStorageFixture();
  const bytes = Buffer.from("Esto no es una imagen.");

  await storage.put("synthetic/fake-image", {
    bytes,
    mimeType: "image/png",
  });

  await assert.rejects(
    readAndValidateSignature(storage, "synthetic/fake-image", {
      mimeType: "image/png",
      sizeBytes: bytes.length,
    }),
    invalidSignature,
  );
});

test("PDGLD-59: un fallo de lectura permite reintentar el mismo objeto", async () => {
  const storage = new SignatureStorageFixture();
  const bytes = await createPng();

  await storage.put("synthetic/retry", {
    bytes,
    mimeType: "image/png",
  });

  storage.failNext("read");

  await assert.rejects(
    readAndValidateSignature(storage, "synthetic/retry", {
      mimeType: "image/png",
      sizeBytes: bytes.length,
    }),
    /SYNTHETIC_STORAGE_FAILURE/,
  );

  const result = await readAndValidateSignature(
    storage,
    "synthetic/retry",
    { mimeType: "image/png", sizeBytes: bytes.length },
  );

  assert.equal(result.sizeBytes, bytes.length);
});

test("PDGLD-59: un objeto inexistente no devuelve una firma válida", async () => {
  const storage = new SignatureStorageFixture();

  await assert.rejects(
    readAndValidateSignature(storage, "synthetic/missing", {
      mimeType: "image/png",
      sizeBytes: 100,
    }),
    /SIGNATURE_OBJECT_NOT_FOUND/,
  );
});