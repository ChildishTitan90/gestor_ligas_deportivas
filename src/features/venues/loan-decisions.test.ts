import test from "node:test";
import assert from "node:assert/strict";
import { nextLoanStage } from "./loan-decisions";

test("el dueño decide antes de la liga", () => {
  assert.throws(() => nextLoanStage("OWNER_PENDING", "LEAGUE", "APPROVED"));
  assert.equal(nextLoanStage("OWNER_PENDING", "OWNER_DELEGATE", "APPROVED"), "LEAGUE_PENDING");
  assert.equal(nextLoanStage("LEAGUE_PENDING", "LEAGUE", "APPROVED"), "APPROVED");
});

test("cualquiera de las dos etapas puede rechazar y la decisión final no se repite", () => {
  assert.equal(nextLoanStage("OWNER_PENDING", "OWNER_DELEGATE", "REJECTED"), "REJECTED");
  assert.equal(nextLoanStage("LEAGUE_PENDING", "LEAGUE", "REJECTED"), "REJECTED");
  assert.throws(() => nextLoanStage("REJECTED", "LEAGUE", "APPROVED"));
  assert.throws(() => nextLoanStage("APPROVED", "OWNER_DELEGATE", "REJECTED"));
});
