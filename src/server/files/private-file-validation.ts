import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
export type BinaryFileMimeType = "image/png" | "image/jpeg" | "application/pdf";

export const PRIVATE_FILE_MAX_BYTES = 10 * 1024 * 1024;

// Límites técnicos de procesamiento, no requisitos adicionales del ERS.
const MAX_IMAGE_PIXELS = 10_000_000;
const MAX_PDF_PAGES = 50;

export class BinaryFileValidationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_FILE"
      | "FILE_TOO_LARGE",
    public readonly status = 400,
  ) {
    super(code);
  }
}

export type ValidatedBinaryFile = {
  bytes: Uint8Array;
  mimeType: BinaryFileMimeType;
  sizeBytes: number;
  sha256: string;
};

export async function validatePrivateFileContent(
  input: Uint8Array,
  declaredMimeType: string,
): Promise<ValidatedBinaryFile> {
  if (input.byteLength === 0) {
    throw new BinaryFileValidationError("INVALID_FILE");
  }

  if (input.byteLength > PRIVATE_FILE_MAX_BYTES) {
    throw new BinaryFileValidationError("FILE_TOO_LARGE", 413);
  }

  const allowed: readonly string[] = [
    "image/png",
    "image/jpeg",
    "application/pdf",
  ];

  if (!allowed.includes(declaredMimeType)) {
    throw new BinaryFileValidationError("INVALID_FILE");
  }

  // Copia propia: no conservar una referencia mutable del llamador.
  const bytes = Buffer.from(input);
  let mimeType: BinaryFileMimeType;

  try {
    if (declaredMimeType === "application/pdf") {
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new BinaryFileValidationError("INVALID_FILE");
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
        throw new BinaryFileValidationError("INVALID_FILE");
      }

      for (const page of document.getPages()) {
        const { width, height } = page.getSize();

        if (
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width <= 0 ||
          height <= 0
        ) {
          throw new BinaryFileValidationError("INVALID_FILE");
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
        throw new BinaryFileValidationError("INVALID_FILE");
      }

      if (metadata.format === "png") {
        mimeType = "image/png";
      } else if (metadata.format === "jpeg") {
        mimeType = "image/jpeg";
      } else {
        throw new BinaryFileValidationError("INVALID_FILE");
      }

      if (mimeType !== declaredMimeType) {
        throw new BinaryFileValidationError("INVALID_FILE");
      }

      // Decodifica la imagen: leer solamente sus metadatos no basta.
      await image.raw().toBuffer();
    }
  } catch {
    // No devolver detalles internos del parser ni contenido del archivo.
    throw new BinaryFileValidationError("INVALID_FILE");
  }

  return {
    bytes,
    mimeType,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
