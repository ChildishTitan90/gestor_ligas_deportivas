import { z } from "zod";
import { pendingEncounterSchema } from "./pending-encounters";

const encounter = z.object({
  matchdayId: z.uuid(),
  round: z.number().int().positive(),
  home: z.uuid(),
  away: z.uuid(),
  venueId: z.uuid(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  reservedUntil: z.iso.datetime(),
}).passthrough().refine(match =>
  match.home !== match.away &&
  Date.parse(match.start) < Date.parse(match.end) &&
  Date.parse(match.end) <= Date.parse(match.reservedUntil), "Intervalo de encuentro inválido");

export const storedProposalSchema = z.object({
  formatVersion: z.literal(1),
  requestHash: z.string().optional(),
  groupId: z.uuid(),
  categoryId: z.uuid(),
  seasonVersion: z.number().int().positive(),
  ruleId: z.uuid(),
  ruleVersion: z.number().int().positive(),
  timezone: z.string().min(1),
  teamNames: z.record(z.string(), z.string()).optional(),
  venueNames: z.record(z.string(), z.string()).optional(),
  matches: z.array(z.union([encounter, pendingEncounterSchema])).min(1).max(1024),
  byes: z.array(z.object({
    matchdayId: z.uuid(), round: z.number().int().positive(), teamId: z.uuid(),
  }).passthrough()),
}).passthrough();

export const editStoredEncounterSchema = z.strictObject({
  proposalId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  encounterIndex: z.number().int().min(0).max(1023),
  venueId: z.uuid(),
  startsAt: z.iso.datetime(),
  swapHomeAway: z.boolean().optional(),
  reason: z.string().trim().min(8).max(500),
});

/** El índice identifica el encuentro únicamente junto a expectedVersion. */
export function replaceStoredEncounter(
  parameters: unknown,
  input: z.infer<typeof editStoredEncounterSchema>,
  interval: { end: string; reservedUntil: string },
) {
  const proposal = storedProposalSchema.parse(parameters);
  const current = proposal.matches[input.encounterIndex];
  if (!current) throw new RangeError("ENCOUNTER_NOT_FOUND");
  const replacement = encounter.parse({
    ...current, venueId: input.venueId, start: input.startsAt,
    end: interval.end, reservedUntil: interval.reservedUntil,
  });
  return {
    ...proposal,
    matches: proposal.matches.map((match, index) => index === input.encounterIndex ? replacement : match),
  };
}
