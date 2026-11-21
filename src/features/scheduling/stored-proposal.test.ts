import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { editStoredEncounterSchema, replaceStoredEncounter } from "./stored-proposal";

test("editar un encuentro conserva el contrato completo de PDGLD-24 y las demás jornadas", () => {
  const id = randomUUID;
  const encounter = {
    matchdayId: id(), round: 1, home: id(), away: id(), venueId: id(),
    start: "2026-11-18T17:00:00.000Z", end: "2026-11-18T18:00:00.000Z",
    reservedUntil: "2026-11-18T18:15:00.000Z", preference: 0,
  };
  const proposal = {
    formatVersion: 1, requestHash: "hash-de-generación", state: "DRAFT_PROPOSAL", reservesResources: false,
    groupId: id(), categoryId: id(), seasonVersion: 3, ruleId: id(), ruleVersion: 2, timezone: "UTC",
    matches: [encounter, { ...encounter, matchdayId: id(), round: 2, home: encounter.away, away: encounter.home }],
    byes: [{ matchdayId: id(), round: 3, teamId: id() }],
    teamNames: { [encounter.home]: "Local" }, venueNames: { [encounter.venueId]: "Cancha" },
  };
  const original = structuredClone(proposal);
  const input = editStoredEncounterSchema.parse({
    proposalId: id(), expectedVersion: 4, encounterIndex: 0,
    venueId: id(), startsAt: "2026-11-18T19:00:00.000Z", reason: "Cambio de horario autorizado",
  });
  const changed = replaceStoredEncounter(proposal, input, {
    end: "2026-11-18T20:00:00.000Z", reservedUntil: "2026-11-18T20:15:00.000Z",
  });
  assert.deepEqual(proposal, original);
  assert.deepEqual(changed.matches[1], original.matches[1]);
  assert.deepEqual(changed.byes, original.byes);
  assert.deepEqual(changed.teamNames, original.teamNames);
  assert.equal(changed.requestHash, original.requestHash);
  assert.equal(changed.matches[0].matchdayId, encounter.matchdayId);
  assert.equal(changed.matches[0].venueId, input.venueId);
  assert.throws(() => replaceStoredEncounter(proposal, { ...input, encounterIndex: 2 }, {
    end: "2026-11-18T20:00:00.000Z", reservedUntil: "2026-11-18T20:15:00.000Z",
  }), /ENCOUNTER_NOT_FOUND/);
  assert.throws(() => replaceStoredEncounter(proposal, input, {
    end: "2026-11-18T18:00:00.000Z", reservedUntil: "2026-11-18T18:15:00.000Z",
  }));
});
