import test from "node:test";
import assert from "node:assert/strict";
import { fitsLoanWindow, parseLoanWindows } from "./loan-windows";

test("partido y holgura caben completos en una ventana aprobada", () => {
  const start = Date.parse("2026-11-22T15:00:00Z");
  const windows = parseLoanWindows([{ startsAt: "2026-11-22T15:00:00Z", endsAt: "2026-11-22T17:00:00Z" }]);
  assert.equal(fitsLoanWindow(windows, start, start + 120 * 60000), true);
  assert.equal(fitsLoanWindow(windows, start, start + 121 * 60000), false);
  assert.equal(fitsLoanWindow(windows, start - 1, start + 60000), false);
  assert.equal(fitsLoanWindow([{ start: 0, end: 60 }, { start: 60, end: 120 }], 0, 120), false);
});

test("préstamos legados o ventanas inválidas no conceden disponibilidad", () => {
  for (const value of [null, [], {}, [{ startsAt: "2026-11-22T17:00:00Z", endsAt: "2026-11-22T15:00:00Z" }]]) {
    assert.deepEqual(parseLoanWindows(value), []);
  }
});
