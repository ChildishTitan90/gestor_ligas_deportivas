import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import type { SignatureMimeType } from "./signature-storage";

export const SIGNATURE_MAX_BYTES = 10 * 1024 * 1024;

// Límites técnicos de procesamiento, no requisitos adicionales del ERS.
const MAX_IMAGE_PIXELS = 10_000_000;
const MAX_PDF_PAGES = 50;

export class SignatureValidationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_SIGNATURE"
      | "SIGNATURE_TOO_LARGE",
    public readonly status = 400,
  ) {
    super(code);
  }
}

export type ValidatedSignature = {
  bytes: Uint8Array;
  mimeType: SignatureMimeType;
  sizeBytes: number;
  sha256: string;
};

export async function validateSignatureContent(
  input: Uint8Array,
  declaredMimeType: string,
): Promise<ValidatedSignature> {
  if (input.byteLength === 0) {
    throw new SignatureValidationError("INVALID_SIGNATURE");
  }

  if (input.byteLength > SIGNATURE_MAX_BYTES) {
    throw new SignatureValidationError("SIGNATURE_TOO_LARGE", 413);
  }

  const allowed: readonly string[] = [
    "image/png",
    "image/jpeg",
    "application/pdf",
  ];

  if (!allowed.includes(declaredMimeType)) {
    throw new SignatureValidationError("INVALID_SIGNATURE");
  }

  // Copia propia: no conservar una referencia mutable del llamador.
  const bytes = Buffer.from(input);
  let mimeType: SignatureMimeType;

  try {
    if (declaredMimeType === "application/pdf") {
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new SignatureValidationError("INVALID_SIGNATURE");
      }

      const document = await PDFDocument.load(bytes, {
        ignoreEncryption: false,
        throwOnInvalidObject: true,
        updateMetadata: false,
      });

      const pageCount = document.getPageCount();

      if (
        document.isEncrypted ||
        pageCount < 1 ||
        pageCount > MAX_PDF_PAGES
      ) {
        throw new SignatureValidationError("INVALID_SIGNATURE");
      }

      for (const page of document.getPages()) {
        const { width, height } = page.getSize();

        if (
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width <= 0 ||
          height <= 0
        ) {
          throw new SignatureValidationError("INVALID_SIGNATURE");
        }
      }

      mimeType = "application/pdf";
    } else {
      const image = sharp(bytes, {
        failOn: "warning",
        limitInputPixels: MAX_IMAGE_PIXELS,
      });

      const metadata = await image.metadata();

      if (
        !metadata.width ||
        !metadata.height ||
        (metadata.pages ?? 1) !== 1
      ) {
        throw new SignatureValidationError("INVALID_SIGNATURE");
      }

      if (metadata.format === "png") {
        mimeType = "image/png";
      } else if (metadata.format === "jpeg") {
        mimeType = "image/jpeg";
      } else {
        throw new SignatureValidationError("INVALID_SIGNATURE");
      }

      if (mimeType !== declaredMimeType) {
        throw new SignatureValidationError("INVALID_SIGNATURE");
      }

      // Decodifica la imagen: leer solamente sus metadatos no basta.
      await image.raw().toBuffer();
    }
  } catch {
    // No devolver detalles internos del parser ni contenido del archivo.
    throw new SignatureValidationError("INVALID_SIGNATURE");
  }

  return {
    bytes,
    mimeType,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
