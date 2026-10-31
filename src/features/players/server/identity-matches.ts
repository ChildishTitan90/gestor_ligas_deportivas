import "server-only";
import type { Prisma } from "@prisma/client";
import { adjacentBirthDates, isPossibleIdentityMatch, type IdentityForMatching } from "../identity-rules";
import { PlayerRegistrationError } from "./access";

export const personIdentitySelect = {
  id: true, first_name: true, paternal_surname: true, maternal_surname: true, birth_date: true,
} satisfies Prisma.peopleSelect;

export function identityFromPerson(person: Prisma.peopleGetPayload<{ select: typeof personIdentitySelect }>): IdentityForMatching {
  return { firstName: person.first_name, paternalSurname: person.paternal_surname,
    maternalSurname: person.maternal_surname, birthDate: person.birth_date?.toISOString().slice(0, 10) ?? "" };
}

/** Coincidencias internas: estos datos no salen del servidor ni se registran en logs. */
export async function findPossibleIdentityMatches(tx: Prisma.TransactionClient, identity: IdentityForMatching, excludeId?: string) {
  const dates = adjacentBirthDates(identity.birthDate);
  const candidates = await tx.people.findMany({ where: { birth_date: {
    gte: new Date(dates[0]), lte: new Date(dates[2]),
  }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: personIdentitySelect, take: 1001 });
  // Una colección truncada nunca se interpreta como ausencia de coincidencias.
  if (candidates.length > 1000) throw new PlayerRegistrationError("REVIEW_CAPACITY_EXCEEDED");
  return candidates.filter(candidate => isPossibleIdentityMatch(identity, identityFromPerson(candidate))).map(row => row.id);
}
