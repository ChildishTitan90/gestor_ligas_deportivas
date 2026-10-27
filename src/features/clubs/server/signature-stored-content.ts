import "server-only";

import type {
  PrivateSignatureStorage,
  SignatureMimeType,
} from "./signature-storage";
import {
  SignatureValidationError,
  validateSignatureContent,
} from "./signature-validation";

export async function readAndValidateSignature(
  storage: PrivateSignatureStorage,
  key: string,
  expected: {
    mimeType: SignatureMimeType;
    sizeBytes: number;
  },
) {
  const stored = await storage.read(key);

  const validated = await validateSignatureContent(
    stored.bytes,
    expected.mimeType,
  );

  if (
    stored.mimeType !== expected.mimeType ||
    validated.sizeBytes !== expected.sizeBytes
  ) {
    throw new SignatureValidationError("INVALID_SIGNATURE");
  }

  return validated;
}