import "server-only";

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import {
  assertPermission,
  AuthorizationError,
} from "@/server/auth/authorization";
import { createSupabaseSignatureStorage } from
  "./supabase-signature-storage";

const storageKeySchema = z.tuple([
  z.literal("affiliation-signatures"),
  z.literal("v1"),
  z.uuid(),
  z.uuid(),
  z.uuid(),
  z.enum(["PRESIDENT", "SECRETARY", "TREASURER"]),
  z.uuid(),
]);

// actorId debe obtenerse de la sesión en el servidor.
export async function assertSignatureDownloadAccess(
  tx: Prisma.TransactionClient,
  actorId: string,
  signatureFileId: string,
) {
  const parsedId = z.uuid().safeParse(signatureFileId);

  if (!parsedId.success) {
    throw new AuthorizationError();
  }

  const file = await tx.files.findUnique({
    where: { id: parsedId.data.toLowerCase() },
    select: {
      id: true,
      storage_key: true,
      uploaded_by: true,
    },
  });

  // Evitar revelar si un identificador ajeno existe.
  if (!file) {
    throw new AuthorizationError();
  }

  const parsedKey = storageKeySchema.safeParse(
    file.storage_key.split("/"),
  );

  if (!parsedKey.success) {
    throw new AuthorizationError();
  }

  const [
    ,
    ,
    clubId,
    seasonId,
    uploaderId,
    ,
    storedFileId,
  ] = parsedKey.data;

  if (
    storedFileId !== file.id ||
    uploaderId !== file.uploaded_by
  ) {
    throw new AuthorizationError();
  }

  // El contexto procede del registro del servidor,
  // no de un club enviado por el navegador.
  const seasons = await tx.$queryRaw<
    { leagueId: string }[]
  >`
    SELECT s.league_id AS "leagueId"
    FROM sports_management.seasons s
    JOIN sports_management.clubs c
      ON c.league_id = s.league_id
    WHERE s.id = ${seasonId}::uuid
      AND c.id = ${clubId}::uuid
    FOR SHARE OF s, c
  `;

  const season = seasons[0];

  if (!season) {
    throw new AuthorizationError();
  }

  await assertPermission(tx, actorId, {
    module: "clubs",
    action: "READ",
    context: {
      leagueId: season.leagueId,
      clubId,
    },
  });

  // Leer una firma no exige que la temporada siga abierta.
  return { storageKey: file.storage_key };
}

export async function createSignatureDownload(
  signatureFileId: string,
) {
  const actor = await requireOperationalUser();
  const db = getPrisma();

  const authorized = await db.$transaction((tx) =>
    assertSignatureDownloadAccess(
      tx,
      actor.id,
      signatureFileId,
    ),
  );

  // Consultar Storage solo después de autorizar.
  const download = await createSupabaseSignatureStorage()
    .createDownloadUrl(authorized.storageKey);

  // Detectar revocaciones durante la consulta a Storage.
  await db.$transaction(async (tx) => {
    const current = await assertSignatureDownloadAccess(
      tx,
      actor.id,
      signatureFileId,
    );

    if (current.storageKey !== authorized.storageKey) {
      throw new AuthorizationError();
    }
  });

  return {
    downloadUrl: download.signedUrl,
    expiresInSeconds: download.expiresInSeconds,
  };
}