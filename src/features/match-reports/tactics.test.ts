import assert from "node:assert/strict";
import test from "node:test";
import { advanceMatchClock } from "./match-clock";
import { randomUUID } from "node:crypto";
import { currentPitch, formationSlots, formations, participationPeriods, tacticSchema } from "./tactics";
import { canonicalAffiliationSubmission, affiliationSubmissionSchema } from "@/features/clubs/affiliation-submission";
import { defaultUniformKits, hexRGB, rgbHex, uniformKitsSchema } from "@/features/clubs/uniform-kits";
import type { ReportEvent, ReportLineup } from "./types";

const team = randomUUID(), starter = randomUUID(), substitute = randomUUID(), third = randomUUID();
const event = (code: string, playerId: string, outgoingPlayerId: string | null = null, minute: number | null = 12): ReportEvent => ({ id: randomUUID(), teamId: team, typeCode: code, playerId, outgoingPlayerId, periodNumber: minute === null ? null : 1, minute, description: "" });
const initial = () => formationSlots("4-2-3-1").map((s, i) => ({ ...s, playerId: i === 0 ? starter : null }));

test("quince formaciones, once lugares y posiciones personalizadas serializables", () => {
  assert.equal(formations.length, 15);
  for (const formation of formations) {
    const slots = formationSlots(formation);
    assert.equal(slots.length, 11);
    assert.equal(new Set(slots.map(s => `${s.x}:${s.y}`)).size, 11);
    assert.ok(tacticSchema.safeParse({ formation, slots, kitSource: null, kit: null }).success);
  }
  const custom = { formation: "CUSTOM", slots: initial(), kitSource: "custom", kit: defaultUniformKits.home };
  assert.ok(tacticSchema.safeParse(custom).success);
  custom.slots[1].playerId = starter;
  assert.equal(tacticSchema.safeParse(custom).success, false);
  custom.slots[1].playerId = null; custom.slots[1].x = 200;
  assert.equal(tacticSchema.safeParse(custom).success, false);
});
test("cambio mueve al suplente, conserva el once inicial; lesión no cambia posiciones y roja deja vacante", () => {
  const slots = initial();
  const change = event("SUBSTITUTION", substitute, starter);
  const current = currentPitch(slots, [change, event("INJURY", substitute)], team);
  assert.equal(current.slots[0].playerId, substitute);
  assert.equal(slots[0].playerId, starter);
  assert.equal(current.problems.length, 0);
  assert.equal(currentPitch(slots, [change, event("SENDING_OFF", substitute)], team).slots[0].playerId, null);
  assert.equal(currentPitch(slots, [change, event("SUBSTITUTION", starter, substitute)], team).problems.length, 1);
  assert.equal(currentPitch(slots, [event("SUBSTITUTION", substitute, third)], team).problems.length, 1);
});
test("captura posterior ordenada por tiempos completos y orden de captura cuando faltan", () => {
  const a = event("SUBSTITUTION", substitute, starter, 10), b = event("SUBSTITUTION", third, substitute, 20);
  assert.equal(currentPitch(initial(), [b, a], team).slots[0].playerId, third);
  const noTime = { ...b, minute: null };
  assert.equal(currentPitch(initial(), [noTime, a], team).problems.length, 1);
  assert.equal(currentPitch(initial(), [a, noTime], team).slots[0].playerId, third);
});
test("tiempos derivados reversibles; no inventa duración ni minuto desconocido", () => {
  const outgoing: ReportLineup = { playerId: starter, selected: true, starter: true, matchJersey: 7, periods: [{ periodNumber: 1, entryMinute: 0, exitMinute: null }] };
  const incoming: ReportLineup = { ...outgoing, playerId: substitute, starter: false, periods: [] };
  const change = event("SUBSTITUTION", substitute, starter, 14);
  assert.deepEqual(participationPeriods(outgoing, [change]), [{ periodNumber: 1, entryMinute: 0, exitMinute: 14 }]);
  assert.deepEqual(participationPeriods(incoming, [change]), [{ periodNumber: 1, entryMinute: 14, exitMinute: null }]);
  assert.deepEqual(participationPeriods(outgoing, []), outgoing.periods);
  assert.deepEqual(participationPeriods(incoming, [event("SUBSTITUTION", substitute, starter, null)]), []);
  assert.equal(outgoing.periods[0].exitMinute, null);
});
test("RGB validado, conversión nativa y huella de afiliación compatible con contratos anteriores", () => {
  assert.deepEqual(hexRGB("#123b4a"), { r: 18, g: 59, b: 74 });
  assert.equal(rgbHex(hexRGB("#00ff08")), "#00ff08");
  assert.equal(uniformKitsSchema.safeParse({ ...defaultUniformKits, home: { ...defaultUniformKits.home, primary: { r: 256, g: 1, b: 2 } } }).success, false);
  const person = { firstName: "Persona sintética", paternalSurname: "Ensayo", maternalSurname: "", signatureFileId: randomUUID() };
  const legacy = affiliationSubmissionSchema.parse({ submissionKey: randomUUID(), clubId: randomUUID(), seasonId: randomUUID(), clubName: "Club sintético", uniformColors: "Azul y blanco", categoryIds: [randomUUID()], officers: { PRESIDENT: person, SECRETARY: person, TREASURER: person } });
  assert.equal(Object.hasOwn(JSON.parse(canonicalAffiliationSubmission(legacy)), "uniformKits"), false);
  assert.notEqual(canonicalAffiliationSubmission(legacy), canonicalAffiliationSubmission({ ...legacy, uniformKits: defaultUniformKits }));
});


test("PDGLD-16: suplente de primera mitad conserva entrada y cierra salida al descanso real", () => {
  const row: ReportLineup = { playerId: substitute, selected: true, starter: false,
    matchJersey: 9, participationHalf: 1, periods: [] };
  const entry = event("SUBSTITUTION", substitute, starter, 20);
  const started = advanceMatchClock(null, { type: "start", halfMinutes: 45, breakMinutes: 15 }, "2026-11-19T18:00:00Z");
  const rest = advanceMatchClock(started, { type: "end-half" }, "2026-11-19T18:48:00Z");
  assert.deepEqual(participationPeriods(row, [entry], rest), [{ periodNumber: 1, entryMinute: 20, exitMinute: 48 }]);
  assert.deepEqual(participationPeriods(row, [entry], started), [{ periodNumber: 1, entryMinute: 20, exitMinute: null }]);
  assert.deepEqual(participationPeriods(row, [], rest), [], "La reserva no inventa participación de quien no entró");
  const explicit = { ...row, periods: [{ periodNumber: 1, entryMinute: 20, exitMinute: 30 }] };
  assert.deepEqual(participationPeriods(explicit, [], rest), explicit.periods, "No sobrescribe una salida anterior");
  const exit = { ...event("SUBSTITUTION", third, substitute, 45), periodNumber: 2, periodMinute: 0, second: 0 };
  assert.deepEqual(participationPeriods(row, [entry, exit], rest), [{ periodNumber: 1, entryMinute: 20, exitMinute: 48 }]);
  assert.deepEqual(row.periods, [], "La proyección no modifica el borrador original");
});
