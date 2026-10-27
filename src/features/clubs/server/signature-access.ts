import "server-only";

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import {
  assertPermission,
  AuthorizationError,
  lockAuthorization,
} from "@/server/auth/authorization";

const signatureContextSchema = z.strictObject({
  clubId: z.uuid().transform((id) => id.toLowerCase()),
  seasonId: z.uuid().transform((id) => id.toLowerCase()),
});

export class SignatureAccessError extends Error {
  constructor(
    public readonly code: "INVALID_CONTEXT" | "SEASON_CLOSED",
    public readonly status = 400,
  ) {
    super(code);
  }
}

// actorId debe proceder de NextAuth en el servidor.
// Se reutilizará dentro de la transacción que registre el archivo.
export async function assertSignatureUploadAccess(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: unknown,
) {
  const parsed = signatureContextSchema.safeParse(input);

  if (!parsed.success) {
    throw new SignatureAccessError("INVALID_CONTEXT");
  }

  const context = parsed.data;

  await lockAuthorization(tx);
  // El modo procede de PostgreSQL, nunca de un permiso elegido por el cliente.
  const affiliations = await tx.$queryRaw<{
    status: string; review_reason: string | null; requested_by: string;
  }[]>`
    SELECT status, review_reason, requested_by FROM sports_management.club_affiliations
    WHERE club_id = ${context.clubId}::uuid AND season_id = ${context.seasonId}::uuid
    FOR SHARE
  `;
  const affiliation = affiliations[0];
  const correcting = affiliation?.status === "PENDING" && !!affiliation.review_reason;
  if (correcting && affiliation.requested_by !== actorId) throw new AuthorizationError();

  // Para una afiliación nueva se autoriza por club.
  // El contexto club+temporada del guard presupone una afiliación existente.
  const grants = await assertPermission(tx, actorId, {
    module: "clubs",
    action: correcting ? "UPDATE" : "CREATE",
    context: { clubId: context.clubId, ...(correcting ? { seasonId: context.seasonId } : {}) },
  });

  const delegate = await tx.roles.findUniqueOrThrow({
    where: { code: "CLUB_DELEGATE" },
    select: { id: true },
  });

  const allowed = grants.some(
    (grant) =>
      grant.roleId === delegate.id &&
      grant.clubId === context.clubId,
  );

  if (!allowed) {
    throw new AuthorizationError();
  }

  const seasons = await tx.$queryRaw<
    { leagueId: string; status: string }[]
  >`
    SELECT s.league_id AS "leagueId", s.status
    FROM sports_management.seasons s
    JOIN sports_management.clubs c
      ON c.league_id = s.league_id
    WHERE s.id = ${context.seasonId}::uuid
      AND c.id = ${context.clubId}::uuid
    FOR SHARE OF s, c
  `;

  const season = seasons[0];

  if (!season) {
    throw new SignatureAccessError("INVALID_CONTEXT");
  }

  if (season.status === "CLOSED") {
    throw new SignatureAccessError("SEASON_CLOSED", 409);
  }

  return {
    ...context,
    leagueId: season.leagueId,
  };
}

// Entrada para iniciar una carga: obtiene la identidad del servidor.
// Este resultado no sustituye la revalidación al registrar el archivo.
export async function requireSignatureUploadAccess(input: unknown) {
  const actor = await requireOperationalUser();

  const context = await getPrisma().$transaction((tx) =>
    assertSignatureUploadAccess(tx, actor.id, input),
  );

  return {
    actorId: actor.id,
    ...context,
  };
}
