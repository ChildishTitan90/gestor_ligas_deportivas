import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pendingEncounter, pendingEncounterSchema } from "./pending-encounters";

test("un pendiente conserva equipos y jornada sin atribuir sede ni horario", () => {
  const match = { matchdayId: randomUUID(), round: 1, home: randomUUID(), away: randomUUID() };
  assert.deepEqual(pendingEncounter(match), { ...match, venueId: null, start: null, end: null, reservedUntil: null });
  assert.equal(pendingEncounterSchema.safeParse({ ...pendingEncounter(match), venueId: randomUUID() }).success, false);
  assert.throws(() => pendingEncounter({ ...match, away: match.home }));
});
