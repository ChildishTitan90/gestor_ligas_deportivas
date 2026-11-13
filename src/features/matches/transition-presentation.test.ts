import assert from "node:assert/strict";
import test from "node:test";
import { availableMatchActions } from "./transition-presentation";

test("las acciones requieren capacidad y un estado de origen válido", () => {
  const none = { canSchedule: false, canRecordMatch: false, canCancel: false };
  assert.deepEqual(availableMatchActions("CONFIRMED", none), []);
  assert.deepEqual(availableMatchActions("CONFIRMED", { ...none, canRecordMatch: true }).map(a => a.toStatus), ["IN_PROGRESS"]);
  assert.deepEqual(availableMatchActions("SUSPENDED", { ...none, canCancel: true }).map(a => a.toStatus), ["CANCELED"]);
  assert.deepEqual(availableMatchActions("FINISHED", { canSchedule: true, canRecordMatch: true, canCancel: true }), []);
});
