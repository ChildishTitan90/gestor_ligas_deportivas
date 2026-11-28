import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { playoffVenueAllowed } from "./playoff-venue";

const venue = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
function fixture(policy: unknown, assigned = false) {
  return {
    matches: { findUniqueOrThrow: async () => ({ home_team_id: "team", competition_stages: { format: { kind: "PLAYOFF_8" }, competition_rule_id: "rule" } }) },
    competition_rule_parameters: { findFirst: async () => ({ parameter_value: { playoff: { format: { quarterfinals: "SINGLE", semifinals: "SINGLE", final: "SINGLE" }, preliminaryTiebreaker: "PENALTIES", venuePolicy: policy } } }) },
    home_venue_assignments: { findFirst: async () => assigned ? { id: "assignment" } : null },
  } as unknown as Prisma.TransactionClient;
}
test("la liguilla neutral acepta solo las canchas elegidas", async () => {
  const tx = fixture({ mode: "NEUTRAL", venueIds: [venue] });
  assert.equal(await playoffVenueAllowed(tx, "match", venue, "2030-07-07", "COMPLEX"), true);
  assert.equal(await playoffVenueAllowed(tx, "match", other, "2030-07-07", "OWN"), false);
});
test("la liguilla en casa acepta cancha propia, préstamo y asignación de la liga", async () => {
  const tx = fixture({ mode: "HOME" });
  assert.equal(await playoffVenueAllowed(tx, "match", venue, "2030-07-07", "OWN"), true);
  assert.equal(await playoffVenueAllowed(tx, "match", venue, "2030-07-07", "HOME_LOAN"), true);
  assert.equal(await playoffVenueAllowed(tx, "match", venue, "2030-07-07", "COMPLEX"), false);
  assert.equal(await playoffVenueAllowed(fixture({ mode: "HOME" }, true), "match", venue, "2030-07-07", "COMPLEX"), true);
});
