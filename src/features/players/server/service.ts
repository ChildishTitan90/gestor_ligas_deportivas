import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { adjacentBirthDates, sameIdentity } from "../identity-rules";
import { registerPlayerSchema } from "../schemas";
import type { RegisterPlayerResult } from "../types";
import { assertReusableIdentity, lockPlayerTeamContext, PlayerRegistrationError } from "./access";
import { findPossibleIdentityMatches, identityFromPerson, personIdentitySelect } from "./identity-matches";

export async function registerPlayer(input: unknown, expectedActorId?: string): Promise<RegisterPlayerResult> {
  const actor = await requireOperationalUser();
  if (expectedActorId && actor.id !== expectedActorId.toLowerCase()) throw new AuthorizationError();
  return registerPlayerForActor(actor.id, input);
}

/** Llamadores internos de servidor solamente; actorId procede de la sesión, nunca del payload. */
export async function registerPlayerForActor(actorId: string, input: unknown): Promise<RegisterPlayerResult> {
  const parsed = registerPlayerSchema.safeParse(input);
  if (!parsed.success) throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
  const { identity, seasonTeamId } = parsed.data;
  try {
    return await getPrisma().$transaction(async tx => {
      const { row: context } = await lockPlayerTeamContext(tx, actorId, seasonTeamId, "CREATE");
      // Orden estable, incluyendo fechas vecinas, para dos identidades similares concurrentes.
      for (const date of adjacentBirthDates(identity.birthDate)) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-97:birth:${date}`}, 0))::text`;
      }
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-97:curp:${identity.curp}`}, 0))::text`;
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true),
        set_config('app.reason', 'PDGLD-97: identidad e inscripción local sin aprobación deportiva', true)`;

      // Buscar por CURP no autoriza a devolver ni modificar la identidad encontrada.
      const existingId = await tx.people.findUnique({ where: { curp: identity.curp }, select: { id: true } });
      let personId: string;
      if (existingId) {
        personId = existingId.id;
        await assertReusableIdentity(tx, actorId, personId, context);
        await tx.$queryRaw`SELECT id FROM sports_management.people WHERE id = ${personId}::uuid FOR UPDATE`;
        const person = await tx.people.findUniqueOrThrow({ where: { id: personId }, select: personIdentitySelect });
        if (!sameIdentity(identity, identityFromPerson(person))) throw new PlayerRegistrationError("IDENTITY_UNAVAILABLE");
        const prior = await tx.player_registrations.findFirst({ where: { person_id: personId,
          OR: [{ season_team_id: seasonTeamId }, { season_id: context.seasonId, withdrawn_at: null }] },
          select: { id: true, season_team_id: true, status: true, withdrawn_at: true, identity_review_status: true } });
        if (prior) {
          if (prior.season_team_id !== seasonTeamId || prior.withdrawn_at) throw new PlayerRegistrationError("REGISTRATION_CONFLICT");
          return { personId, registrationId: prior.id, ...safeContext(context), status: prior.status,
            identityReviewStatus: prior.identity_review_status as RegisterPlayerResult["identityReviewStatus"],
            localValidation: "VALID", externalVerification: "NOT_PERFORMED", replayed: true };
        }
      } else {
        // La creación de Persona queda dentro de la misma transacción que la inscripción.
        const person = await tx.people.create({ data: { curp: identity.curp, first_name: identity.firstName,
          paternal_surname: identity.paternalSurname, maternal_surname: identity.maternalSurname,
          birth_date: new Date(identity.birthDate) }, select: { id: true } });
        personId = person.id;
        // people no tiene record_audit: registrar solo el identificador, sin PII.
        await tx.audit_logs.create({ data: { user_id: actorId, action: "PLAYER_IDENTITY_CREATED", table_name: "people",
          entity_id: personId, reason: "PDGLD-97: creación local de identidad" } });
      }
      if (context.teamStatus === "WITHDRAWN" || context.seasonStatus === "CLOSED" ||
        context.affiliationStatus !== "APPROVED" || !context.categoryAuthorized)
        throw new PlayerRegistrationError("CONTEXT_NOT_AVAILABLE");
      const matches = await findPossibleIdentityMatches(tx, identity, personId);
      const reviewStatus = matches.length ? "REQUIRED" : "NOT_REQUIRED";
      const registration = await tx.player_registrations.create({ data: { person_id: personId,
        season_team_id: seasonTeamId, season_id: context.seasonId, reference_number: `PLAYER-${randomUUID()}`,
        status: "INELIGIBLE", identity_review_status: reviewStatus }, select: { id: true } });
      if (matches.length) {
        // Señal interna de seguridad: también el primer alta concurrente debe revisarse.
        // No cambia identidades ni revoca aprobaciones deportivas históricas.
        await tx.player_registrations.updateMany({ where: { person_id: { in: matches }, status: "INELIGIBLE",
          identity_review_status: "NOT_REQUIRED", season_teams: { club_affiliations: { seasons: { status: { not: "CLOSED" } } } } },
          data: { identity_review_status: "REQUIRED" } });
      }
      await tx.player_status_history.create({ data: { registration_id: registration.id, new_status: "INELIGIBLE",
        user_id: actorId, reason: "PDGLD-97: captura local pendiente de aprobación deportiva" } });
      return { personId, registrationId: registration.id, ...safeContext(context), status: "INELIGIBLE",
        identityReviewStatus: reviewStatus, localValidation: "VALID", externalVerification: "NOT_PERFORMED", replayed: false };
    }, { timeout: 15_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new PlayerRegistrationError("REGISTRATION_CONFLICT");
      if (["P2034", "P2028"].includes(error.code)) throw new PlayerRegistrationError("RETRY_REQUIRED");
    }
    // Los triggers pueden llegar como error conocido o desconocido según el adaptador.
    // Solo reconocer textos constantes internamente; nunca serializar SQL/PII.
    const adapter = error as { cause?: { originalMessage?: string };
      meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } } } | null;
    const detail = adapter?.meta?.driverAdapterError?.cause?.originalMessage ?? adapter?.cause?.originalMessage ??
      (error instanceof Error ? error.message : "");
    if (detail.includes("Las altas solo se permiten")) throw new PlayerRegistrationError("REGISTRATION_WINDOW_CLOSED");
    if (detail.includes("No se permite cambiar equipo")) throw new PlayerRegistrationError("TEAM_CHANGE_NOT_ALLOWED");
    if (error instanceof PlayerRegistrationError || error instanceof AuthorizationError) throw error;
    // La entrada futura podrá presentar un fallo recuperable sin serializar errores de Prisma.
    throw new PlayerRegistrationError("RETRY_REQUIRED");
  }
}

function safeContext(row: { seasonTeamId: string; teamId: string; clubId: string; leagueId: string; seasonId: string;
  groupId: string; seasonCategoryId: string; categoryId: string }) {
  return { seasonTeamId: row.seasonTeamId, teamId: row.teamId, clubId: row.clubId, leagueId: row.leagueId,
    seasonId: row.seasonId, groupId: row.groupId, seasonCategoryId: row.seasonCategoryId, categoryId: row.categoryId };
}
