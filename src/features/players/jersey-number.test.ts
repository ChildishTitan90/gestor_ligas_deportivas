import assert from "node:assert/strict";
import test from "node:test";
import { jerseyNumberSchema, jerseyNumberFromField, updateJerseyNumberSchema } from "./schemas";

test("el dorsal opcional distingue sin asignar del cero", () => {
  for (const value of [null, "", "  "]) assert.equal(jerseyNumberFromField(value), null);
  assert.equal(jerseyNumberFromField("0"), 0);
  assert.equal(jerseyNumberSchema.parse(null), null);
  assert.equal(updateJerseyNumberSchema.parse({ jerseyNumber: 0 }).jerseyNumber, 0);
});
test("la asignación exige un entero válido y no permite quitarlo ni modificar el ámbito", () => {
  for (const jerseyNumber of [null, undefined, -1, 1.5, NaN, Infinity, 2147483648, "7"])
    assert.equal(updateJerseyNumberSchema.safeParse({ jerseyNumber }).success, false);
  assert.equal(updateJerseyNumberSchema.safeParse({ jerseyNumber: 7, seasonTeamId: "forged" }).success, false);
});
