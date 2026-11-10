import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { updateJerseyNumberSchema } from "../schemas";
import { assertPlayerRegistrationRead, lockPlayerTeamContext, PlayerRegistrationError } from "./access";

export async function readPlayerJerseyNumberForActor(actorId: string, registrationId: string) {
  if (!z.uuid().safeParse(registrationId).success) throw new AuthorizationError();
  return getPrisma().$transaction(async tx => {
    const registration = await tx.player_registrations.findUnique({ where: { id: registrationId },
      select: { season_team_id: true, jersey_number: true, withdrawn_at: true } });
    if (!registration) throw new AuthorizationError();
    const row = await assertPlayerRegistrationRead(tx, actorId, registrationId, registration.season_team_id);
    let canAssign = registration.jersey_number === null && !registration.withdrawn_at &&
      row.seasonStatus !== "CLOSED" && row.teamStatus !== "WITHDRAWN" && row.operational &&
      row.affiliationStatus === "APPROVED" && row.categoryAuthorized;
    if (canAssign) try { await lockPlayerTeamContext(tx, actorId, registration.season_team_id, "UPDATE"); }
    catch (error) { if (!(error instanceof AuthorizationError)) throw error; canAssign = false; }
    return { jerseyNumber: registration.jersey_number, canAssign };
  });
}

export async function updatePlayerJerseyNumber(registrationId: string, input: unknown, expectedActorId?: string) {
  const actor = await requireOperationalUser();
  if (expectedActorId && actor.id !== expectedActorId.toLowerCase()) throw new AuthorizationError();
  return updatePlayerJerseyNumberForActor(actor.id, registrationId, input);
}

export async function updatePlayerJerseyNumberForActor(actorId: string, registrationId: string, input: unknown) {
  const parsed = updateJerseyNumberSchema.safeParse(input);
  if (!z.uuid().safeParse(registrationId).success || !parsed.success)
    throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
  try { return await getPrisma().$transaction(async tx => {
    const registration = await tx.player_registrations.findUnique({ where: { id: registrationId },
      select: { season_team_id: true } });
    if (!registration) throw new AuthorizationError();
    await assertPlayerRegistrationRead(tx, actorId, registrationId, registration.season_team_id);
    const { row } = await lockPlayerTeamContext(tx, actorId, registration.season_team_id, "UPDATE");
    if (row.seasonStatus === "CLOSED" || row.teamStatus === "WITHDRAWN" || !row.operational ||
      row.affiliationStatus !== "APPROVED" || !row.categoryAuthorized)
      throw new PlayerRegistrationError("CONTEXT_NOT_AVAILABLE");
    await tx.$queryRaw`SELECT id FROM sports_management.player_registrations WHERE id=${registrationId}::uuid FOR UPDATE`;
    const current = await tx.player_registrations.findUniqueOrThrow({ where: { id: registrationId },
      select: { jersey_number: true, withdrawn_at: true } });
    if (current.withdrawn_at) throw new PlayerRegistrationError("CONTEXT_NOT_AVAILABLE");
    // Repetir una escritura cuya respuesta se perdió es seguro; un dorsal asignado nunca se cambia.
    if (current.jersey_number !== parsed.data.jerseyNumber) {
      if (current.jersey_number !== null)
        throw new PlayerRegistrationError("JERSEY_NUMBER_LOCKED");
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true),
        set_config('app.reason', 'Actualización del dorsal habitual de la inscripción', true)`;
      await tx.player_registrations.update({ where: { id: registrationId },
        data: { jersey_number: parsed.data.jerseyNumber } });
    }
    return { registrationId, jerseyNumber: parsed.data.jerseyNumber };
  }); } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new PlayerRegistrationError("JERSEY_NUMBER_TAKEN");
    throw error;
  }
}
