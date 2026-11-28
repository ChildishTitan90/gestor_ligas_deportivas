import { test } from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { assertPlayoffDate } from "./playoff-date";

const calendar = { playoff: { regularDeadline: "2030-05-31", format: { quarterfinals: "HOME_AND_AWAY", semifinals: "SINGLE", final: "HOME_AND_AWAY" }, preliminaryTiebreaker: "PENALTIES", dates: ["2030-06-01", "2030-06-08", "2030-06-15", "2030-06-22", "2030-06-29"] } };
function fixture(number: number, leg: number, parameter: unknown = calendar) {
  return { matches: { findUniqueOrThrow: async () => ({ competition_stages: { format: { kind: "PLAYOFF_8" }, competition_rule_id: "rule" }, bracket_matches: { leg_number: leg, brackets: { number } } }) }, competition_rule_parameters: { findFirst: async () => ({ parameter_value: parameter }) } } as unknown as Prisma.TransactionClient;
}
test("cada partido usa la fecha de su ronda y vuelta", async () => {
  for (const [number, leg, date] of [[1,1,"2030-06-01"],[4,2,"2030-06-08"],[5,1,"2030-06-15"],[7,1,"2030-06-22"],[7,2,"2030-06-29"]] as const) {
    await assert.doesNotReject(assertPlayoffDate(fixture(number,leg), "match",date));
    await assert.rejects(assertPlayoffDate(fixture(number,leg), "match","2030-06-30"),{code:"PLAYOFF_ROUND_DATE"});
  }
  await assert.rejects(assertPlayoffDate(fixture(5,2),"match","2030-06-15"),{code:"PLAYOFF_DATES_REQUIRED"});
  await assert.rejects(assertPlayoffDate(fixture(1,1,{}),"match","2030-06-01"),{code:"PLAYOFF_DATES_REQUIRED"});
});
test("la fecha de liguilla no restringe partidos de temporada regular", async () => {
  const tx = { matches: { findUniqueOrThrow: async () => ({ competition_stages: null }) } } as unknown as Prisma.TransactionClient;
  await assert.doesNotReject(assertPlayoffDate(tx,"match","2030-06-30"));
});
