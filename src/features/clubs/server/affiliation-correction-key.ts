import "server-only";
import { createHash } from "node:crypto";

/** Clave estable para completar solicitudes anteriores al contrato de envíos. No concede permisos. */
export function affiliationCorrectionKey(id: string, existingKey: string | null) {
  if (existingKey) return existingKey;
  const bytes = createHash("sha256").update(`affiliation-correction:v1:${id.toLowerCase()}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
