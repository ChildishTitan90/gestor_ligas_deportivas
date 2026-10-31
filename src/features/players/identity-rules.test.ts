import assert from "node:assert/strict";
import test from "node:test";
import { adjacentBirthDates, curpMatchesBirthDate, hasValidCurpStructure, isCalendarDate,
  isPossibleIdentityMatch, normalizeCurp, sameIdentity } from "./identity-rules";
import { registerPlayerSchema } from "./schemas";

// Valores sintéticos: no se envían a un proveedor ni representan identidad acreditada.
const valid = "GARA000229HMNRZLA6";
const identity = { firstName: "Álvaro", paternalSurname: "García", maternalSurname: "Ruiz", birthDate: "2000-02-29" };

test("normaliza CURP sin corregir espacios internos ni caracteres ajenos", () => {
  assert.equal(normalizeCurp(`  ${valid.toLowerCase()}  `), valid);
  assert.equal(hasValidCurpStructure(valid), true);
  assert.equal(hasValidCurpStructure(valid.slice(0, 8) + " " + valid.slice(8)), false);
  assert.equal(hasValidCurpStructure(valid.replace("MN", "ZZ")), false);
  assert.equal(hasValidCurpStructure(valid.slice(0, 13) + "AAA" + valid.slice(16)), false);
  assert.equal(hasValidCurpStructure(valid.slice(0, 17) + "0"), false);
});

test("valida fechas reales, bisiestos y siglo sin inferir 19xx por YY", () => {
  assert.equal(isCalendarDate("2000-02-29"), true);
  assert.equal(isCalendarDate("1900-02-29"), false);
  assert.equal(isCalendarDate("2001-04-31"), false);
  assert.equal(isCalendarDate("0000-01-01"), false);
  assert.equal(isCalendarDate("26-01-01"), false);
  assert.equal(curpMatchesBirthDate(valid, "2000-02-29"), true);
  assert.equal(curpMatchesBirthDate(valid, "1900-02-29"), false);
  assert.equal(curpMatchesBirthDate("GARA990101HMNRZL01", "1999-01-01"), true);
  assert.equal(curpMatchesBirthDate("GARA990101HMNRZL01", "2099-01-01"), false);
  assert.equal(curpMatchesBirthDate("GARA990101HMNRZLA1", "1999-01-01"), false);
  assert.equal(curpMatchesBirthDate("GARA990101HMNRZL01", "1899-01-01"), true);
  assert.deepEqual(adjacentBirthDates("2000-03-01"), ["2000-02-29", "2000-03-01", "2000-03-02"]);
});

test("el contrato rechaza autoridad, contexto y verificación enviados por el cliente", () => {
  const input = { seasonTeamId: "00000000-0000-4000-8000-000000000001", identity: { ...identity, curp: valid } };
  assert.equal(registerPlayerSchema.safeParse(input).success, true);
  for (const property of ["clubId", "leagueId", "seasonId", "categoryId", "actorId", "verified", "status"])
    assert.equal(registerPlayerSchema.safeParse({ ...input, [property]: "forged" }).success, false);
  assert.equal(registerPlayerSchema.safeParse({ ...input, identity: { ...input.identity, birthDate: "2000-02-28" } }).success, false);
  assert.equal(registerPlayerSchema.safeParse({ ...input, identity: { ...input.identity, firstName: "--" } }).success, false);
});

test("coincidencias señalan acentos, un error por nombre y fecha vecina sin fusionar", () => {
  assert.equal(sameIdentity(identity, { ...identity, firstName: "alvaro", paternalSurname: "Garcia" }), true);
  assert.equal(sameIdentity(identity, { ...identity, firstName: "Albara" }), false);
  assert.equal(sameIdentity({ ...identity, firstName: "李" }, { ...identity, firstName: "王" }), false);
  assert.equal(isPossibleIdentityMatch(identity, { ...identity, firstName: "Alvar" }), true);
  assert.equal(isPossibleIdentityMatch(identity, { ...identity, paternalSurname: "Garzia" }), true);
  assert.equal(isPossibleIdentityMatch(identity, { ...identity, maternalSurname: null }), true);
  assert.equal(isPossibleIdentityMatch(identity, { ...identity, birthDate: "2000-03-01" }), true);
  assert.equal(isPossibleIdentityMatch(identity, { ...identity, birthDate: "2000-03-02" }), false);
  assert.equal(isPossibleIdentityMatch(identity, { ...identity, firstName: "Alvar", birthDate: "2000-03-01" }), false);
  assert.equal(isPossibleIdentityMatch(identity, { ...identity, firstName: "Pedro" }), false);
});
