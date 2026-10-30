import assert from "node:assert/strict";
import test from "node:test";
import { verifyDelegatePositionMigration } from "./delegate-positions-migration.mjs";

test("PDGLD-106: modelo existente y regresiones nuevas de cupo, vigencia y autoría", async () => {
  assert.equal(process.env.PDGLD106_EXCLUSIVE_TEST_RUN, "1", "Solo en el contenedor exclusivo de PDGLD-106; requiere supervisor externo.");
  await verifyDelegatePositionMigration(process.env.PDGLD106_TEST_DATABASE_URL ?? "");
});
