import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SIGNATURE_MAX_BYTES } from "./signature-validation";

const uuid = z.uuid().transform((value) => value.toLowerCase());

const uploadContextSchema = z.strictObject({
  actorId: uuid,
  clubId: uuid,
  seasonId: uuid,
  fileId: uuid,
  office: z.enum(["PRESIDENT", "SECRETARY", "TREASURER"]),
  mimeType: z.enum([
    "image/png",
    "image/jpeg",
    "application/pdf",
  ]),
  sizeBytes: z.number().int().positive().max(SIGNATURE_MAX_BYTES),
});

const ticketSchema = uploadContextSchema.extend({
  expiresAt: z.number().int().positive(),
});

export type SignatureUploadTicket = z.infer<typeof ticketSchema>;

const LIFETIME_SECONDS = 15 * 60;
const PURPOSE = "PDGLD-59:signature-upload:v1:";

export class SignatureUploadTicketError extends Error {
  readonly code = "INVALID_UPLOAD_TICKET";
  readonly status = 403;

  constructor() {
    super("INVALID_UPLOAD_TICKET");
  }
}

function sign(payload: string, secret: string): Buffer {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SIGNATURE_SIGNING_NOT_CONFIGURED");
  }

  return createHmac("sha256", secret)
    .update(PURPOSE)
    .update(payload)
    .digest();
}

// Solo debe llamarse después de autorizar al usuario en el servidor.
// secret procede del servidor; nunca del cuerpo de una petición.
export function createSignatureUploadTicket(
  input: unknown,
  secret: string,
  nowMs = Date.now(),
): string {
  const context = uploadContextSchema.parse(input);

  const claims: SignatureUploadTicket = {
    ...context,
    expiresAt: Math.floor(nowMs / 1000) + LIFETIME_SECONDS,
  };

  const payload = Buffer.from(
    JSON.stringify(claims),
    "utf8",
  ).toString("base64url");

  const signature = sign(payload, secret).toString("base64url");

  return `${payload}.${signature}`;
}

export function verifySignatureUploadTicket(
  token: string,
  authenticatedActorId: string,
  secret: string,
  nowMs = Date.now(),
): SignatureUploadTicket {
  if (token.length > 4096) {
    throw new SignatureUploadTicketError();
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    throw new SignatureUploadTicketError();
  }

  const [payload, signature] = parts;

  if (
    !/^[A-Za-z0-9_-]+$/.test(payload) ||
    !/^[A-Za-z0-9_-]+$/.test(signature)
  ) {
    throw new SignatureUploadTicketError();
  }

  const expected = sign(payload, secret);
  const received = Buffer.from(signature, "base64url");

  if (
    received.toString("base64url") !== signature ||
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    throw new SignatureUploadTicketError();
  }

  let decoded: unknown;

  try {
    const bytes = Buffer.from(payload, "base64url");

    if (bytes.toString("base64url") !== payload) {
      throw new SignatureUploadTicketError();
    }

    decoded = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new SignatureUploadTicketError();
  }

  const claims = ticketSchema.safeParse(decoded);
  const actor = uuid.safeParse(authenticatedActorId);

  if (
    !claims.success ||
    !actor.success ||
    claims.data.actorId !== actor.data ||
    claims.data.expiresAt <= Math.floor(nowMs / 1000)
  ) {
    throw new SignatureUploadTicketError();
  }

  return claims.data;
}
