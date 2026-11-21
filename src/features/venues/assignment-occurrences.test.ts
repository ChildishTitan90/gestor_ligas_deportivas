import test from "node:test";
import assert from "node:assert/strict";
import { assignmentOccurrences } from "./assignment-occurrences";

test("genera las fechas semanales en la zona de la liga", () => {
  assert.deepEqual(assignmentOccurrences("2026-11-01", "2026-11-15", 7, "10:00", "America/Mexico_City")
    .map(date => date.toISOString()), ["2026-11-01T16:00:00.000Z", "2026-11-08T16:00:00.000Z", "2026-11-15T16:00:00.000Z"]);
});

test("rechaza periodos inválidos y horas inexistentes", () => {
  assert.throws(() => assignmentOccurrences("2026-02-30", "2026-03-10", 1, "10:00", "UTC"));
  assert.throws(() => assignmentOccurrences("2026-03-08", "2026-03-08", 7, "02:30", "America/New_York"));
});
