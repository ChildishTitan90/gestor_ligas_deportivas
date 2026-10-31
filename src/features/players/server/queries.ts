import "server-only";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError, getPermissionGrants } from "@/server/auth/authorization";
import type { PlayerRegistrationContext } from "../types";
import { assertPlayerRegistrationRead, PlayerRegistrationError } from "./access";
import { findPossibleIdentityMatches, identityFromPerson, personIdentitySelect } from "./identity-matches";
import { hasCurrentIdentityResolution } from "./identity-review";

export async function getPlayerRegistrationContext(registrationId: string): Promise<PlayerRegistrationContext | null> {
  const actor = await requireOperationalUser();
  return readPlayerRegistrationForActor(actor.id, registrationId);
}

/** Contrato interno autorizado para expediente y elegibilidad; nunca una búsqueda pública por CURP. */
export async function readPlayerRegistrationForActor(actorId: string, registrationId: string): Promise<PlayerRegistrationContext | null> {
  if (!z.uuid().safeParse(registrationId).success) throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
  return getPrisma().$transaction(async tx => {
    const grants = await getPermissionGrants(tx, actorId, "players", "READ");
    if (!grants.length) throw new AuthorizationError();
    const registration = await tx.player_registrations.findUnique({ where: { id: registrationId }, select: {
      id: true, person_id: true, season_team_id: true, status: true, identity_review_status: true,
    } });
    if (!registration) return null;
    const context = await assertPlayerRegistrationRead(tx, actorId, registrationId, registration.season_team_id);
    const person = await tx.people.findUniqueOrThrow({ where: { id: registration.person_id }, select: personIdentitySelect });
    // La lectura vuelve a evaluar coincidencias: no confía en una captura antigua.
    const matches = person.birth_date ? await findPossibleIdentityMatches(tx, identityFromPerson(person), person.id) : [];
    return { personId: person.id, registrationId, seasonTeamId: context.seasonTeamId, teamId: context.teamId,
      clubId: context.clubId, leagueId: context.leagueId, seasonId: context.seasonId,
      seasonCategoryId: context.seasonCategoryId, categoryId: context.categoryId, groupId: context.groupId,
      status: registration.status, identityReviewStatus: matches.length && !await hasCurrentIdentityResolution(tx,registrationId,person.id,matches) ? "REQUIRED" :
        registration.identity_review_status as PlayerRegistrationContext["identityReviewStatus"] };
  });
}
