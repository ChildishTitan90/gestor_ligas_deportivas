import { readAndValidateSignature } from "./signature-stored-content";
import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import {
  assertSignatureUploadAccess,
  requireSignatureUploadAccess,
} from "./signature-access";
import {
  createSignatureUploadTicket,
  verifySignatureUploadTicket,
  type SignatureUploadTicket,
} from "./signature-upload-ticket";
import {
  SIGNATURE_MAX_BYTES,
  SignatureValidationError,
} from "./signature-validation";
import type { PrivateSignatureStorage } from "./signature-storage";

const prepareSchema = z.strictObject({
  clubId: z.uuid(),
  seasonId: z.uuid(),
  office: z.enum(["PRESIDENT", "SECRETARY", "TREASURER"]),
  mimeType: z.enum([
    "image/png",
    "image/jpeg",
    "application/pdf",
  ]),
  sizeBytes: z.number().int().positive().max(SIGNATURE_MAX_BYTES),
});

export class SignatureServiceError extends Error {
  readonly code = "SERVICE_UNAVAILABLE";
  readonly status = 503;

  constructor() {
    super("SERVICE_UNAVAILABLE");
  }
}

function signingSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;

  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new SignatureServiceError();
  }

  return secret;
}

// Ruta generada exclusivamente con datos validados por el servidor.
// El objeto conserva esta clave al quedar registrado.
function objectKey(claims: SignatureUploadTicket): string {
  return [
    "affiliation-signatures",
    "v1",
    claims.clubId,
    claims.seasonId,
    claims.actorId,
    claims.office,
    claims.fileId,
  ].join("/");
}

function context(claims: SignatureUploadTicket) {
  return {
    clubId: claims.clubId,
    seasonId: claims.seasonId,
  };
}

async function existingResult(
  tx: Prisma.TransactionClient,
  claims: SignatureUploadTicket,
  key: string,
) {
  const file = await tx.files.findUnique({
    where: { id: claims.fileId },
    select: {
      id: true,
      storage_key: true,
      uploaded_by: true,
      mime_type: true,
      size_bytes: true,
    },
  });

  if (!file) return null;

  if (
    file.storage_key !== key ||
    file.uploaded_by !== claims.actorId ||
    file.mime_type !== claims.mimeType ||
    file.size_bytes !== BigInt(claims.sizeBytes)
  ) {
    throw new AuthorizationError();
  }

  return { signatureFileId: file.id };
}

// Esta respuesta es interna del servidor.
// El endpoint posterior generará la URL de subida de Supabase.
export async function prepareSignatureUpload(input: unknown) {
  const data = prepareSchema.safeParse(input);

  if (!data.success) {
    throw new SignatureValidationError("INVALID_SIGNATURE");
  }

  const access = await requireSignatureUploadAccess({
    clubId: data.data.clubId,
    seasonId: data.data.seasonId,
  });

  const secret = signingSecret();

  const ticket = createSignatureUploadTicket({
    actorId: access.actorId,
    clubId: access.clubId,
    seasonId: access.seasonId,
    fileId: randomUUID(),
    office: data.data.office,
    mimeType: data.data.mimeType,
    sizeBytes: data.data.sizeBytes,
  }, secret);

  const claims = verifySignatureUploadTicket(
    ticket,
    access.actorId,
    secret,
  );

  return {
    ticket,
    storageKey: objectKey(claims),
  };
}

export async function confirmSignatureUpload(
  token: string,
  storage: PrivateSignatureStorage,
) {
  const actor = await requireOperationalUser();
  const claims = verifySignatureUploadTicket(
    token,
    actor.id,
    signingSecret(),
  );
  const key = objectKey(claims);
  const db = getPrisma();

  // Autorizar antes de leer el almacenamiento.
  const previous = await db.$transaction(async (tx) => {
    await assertSignatureUploadAccess(tx, actor.id, context(claims));
    return existingResult(tx, claims, key);
  });

  if (previous) return previous;

   const validated = await readAndValidateSignature(storage, key, {
    mimeType: claims.mimeType,
    sizeBytes: claims.sizeBytes,
  }).catch((error: unknown) => {
    if (error instanceof SignatureValidationError) {
      throw error;
    }

    // No exponer errores internos del proveedor de almacenamiento.
    throw new SignatureServiceError();
  });
  return db.$transaction(async (tx) => {
    // Detectar revocaciones ocurridas durante la lectura/validación.
    await assertSignatureUploadAccess(tx, actor.id, context(claims));

    // Dos confirmaciones del mismo archivo no crean dos registros.
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`PDGLD-59:signature:${claims.fileId}`}, 0)
      )::text
    `;

    const existing = await existingResult(tx, claims, key);

    if (existing) return existing;

    await tx.$queryRaw`
      SELECT
        set_config('app.user_id', ${actor.id}, true),
        set_config('app.reason', 'PDGLD-59: registrar firma validada', true)
    `;

    const extension =
      validated.mimeType === "application/pdf"
        ? "pdf"
        : validated.mimeType === "image/png"
          ? "png"
          : "jpg";

    const file = await tx.files.create({
      data: {
        id: claims.fileId,
        storage_key: key,
        original_name: `firma-${claims.office.toLowerCase()}.${extension}`,
        mime_type: validated.mimeType,
        size_bytes: BigInt(validated.sizeBytes),
        sha256: validated.sha256,
        uploaded_by: actor.id,
      },
      select: { id: true },
    });

    return { signatureFileId: file.id };
  });
}