import assert from "node:assert/strict";
import test from "node:test";
import { venueLocalTime, venueTimeToIso } from "./time";

test("interpreta la hora en la zona de la liga y conserva segundos", () => {
  const zone = "America/Mexico_City";
  assert.equal(venueTimeToIso("2026-11-12T18:30", zone), "2026-11-13T00:30:00.000Z");
  assert.equal(venueLocalTime(new Date("2026-11-13T00:30:15.000Z"), zone), "2026-11-12T18:30:15");
});

test("rechaza horas inexistentes, ambiguas y fechas inválidas", () => {
  assert.equal(venueTimeToIso("2026-03-08T02:30", "America/New_York"), "");
  assert.equal(venueTimeToIso("2026-11-01T01:30", "America/New_York"), "");
  assert.equal(venueTimeToIso("2026-02-30T12:00", "America/Mexico_City"), "");
});
