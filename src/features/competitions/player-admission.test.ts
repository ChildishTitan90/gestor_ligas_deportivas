import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePlayerMovement, type PlayerMovementInput } from "./player-admission";

const policy = {
  referenceYear: 2026, minimumAge: 14, maximumAge: 16, exceptionMinimumAge: 13,
  documents: ["PHOTO", "CURP"], registrationDays: [1, 2, 3],
  timezone: "America/Mexico_City", playersOnField: 11,
  maximumCalledUp: 18, maximumRoster: null,
};
function register(birthDate = "2010-12-31", instant = "2026-11-02T18:00:00Z", configured: unknown = policy) {
  return evaluatePlayerMovement({ operation: "REGISTER", policy: configured, birthDate, now: new Date(instant) });
}
const codes = (value: ReturnType<typeof register>) => value.blockers.map(blocker => blocker.code);

test("admite los extremos ordinarios por año, sin depender del cumpleaños", () => {
  for (const dob of ["2010-01-01", "2010-12-31", "2012-01-01", "2012-12-31"])
    assert.deepEqual(register(dob), { status: "RULES_SATISFIED", blockers: [] });
});
test("bloquea por debajo y por encima del rango y mantiene la excepción sin aprobar", () => {
  assert.deepEqual(codes(register("2009-12-31")), ["AGE_OUTSIDE_RANGE"]);
  assert.deepEqual(codes(register("2014-01-01")), ["AGE_OUTSIDE_RANGE"]);
  assert.deepEqual(codes(register("2013-12-31")), ["AGE_EXCEPTION_REQUIRED"]);
});
test("categorías sin excepción y sin máximo conservan su configuración", () => {
  assert.deepEqual(codes(register("2013-12-31", undefined, { ...policy, exceptionMinimumAge: null })), ["AGE_OUTSIDE_RANGE"]);
  for (const minimumAge of [18, 35]) {
    const configured = { ...policy, minimumAge, maximumAge: null, exceptionMinimumAge: null };
    assert.equal(register("1950-01-01", undefined, configured).status, "RULES_SATISFIED");
    assert.deepEqual(codes(register(`${2026 - minimumAge + 1}-01-01`, undefined, configured)), ["AGE_OUTSIDE_RANGE"]);
  }
});
test("rechaza fechas inexistentes y futuras incluso si el rango de edad las admitiría", () => {
  assert.deepEqual(codes(register("2010-02-30")), ["INVALID_BIRTH_DATE"]);
  const young = { ...policy, minimumAge: 0, maximumAge: 8, exceptionMinimumAge: null };
  assert.deepEqual(codes(register("2026-11-03", undefined, young)), ["INVALID_BIRTH_DATE"]);
  assert.equal(register("2026-11-02", undefined, young).status, "RULES_SATISFIED");
});
test("miércoles cierra al iniciar jueves y lunes abre a medianoche local", () => {
  assert.equal(register(undefined, "2026-10-29T05:59:59.999Z").status, "RULES_SATISFIED");
  assert.deepEqual(codes(register(undefined, "2026-10-29T06:00:00.000Z")), ["REGISTRATION_WINDOW_CLOSED"]);
  assert.deepEqual(codes(register(undefined, "2026-11-02T05:59:59.999Z")), ["REGISTRATION_WINDOW_CLOSED"]);
  assert.equal(register(undefined, "2026-11-02T06:00:00.000Z").status, "RULES_SATISFIED");
});
test("lunes a miércoles permiten altas; jueves a domingo las bloquean", () => {
  for (let day = 2; day <= 8; day++) {
    const result = register(undefined, `2026-11-0${day}T18:00:00Z`);
    assert.equal(result.status, day <= 4 ? "RULES_SATISFIED" : "BLOCKED");
  }
});
test("lee días y zona de la política, sin sustituirlos por constantes", () => {
  assert.equal(register(undefined, "2026-11-05T18:00:00Z", { ...policy, registrationDays: [4] }).status, "RULES_SATISFIED");
  assert.deepEqual(codes(register(undefined, "2026-10-29T05:00:00Z", { ...policy, timezone: "UTC" })), ["REGISTRATION_WINDOW_CLOSED"]);
  assert.equal(register(undefined, "2026-10-29T05:00:00Z").status, "RULES_SATISFIED");
});
test("devuelve todos los bloqueos de edad y día sin ocultar uno de ellos", () => {
  assert.deepEqual(codes(register("2009-01-01", "2026-11-05T18:00:00Z")), ["AGE_OUTSIDE_RANGE", "REGISTRATION_WINDOW_CLOSED"]);
});
test("política ausente, inconsistente o manipulada no permite continuar", () => {
  for (const configured of [null, {}, { ...policy, minimumAge: 17 }, { ...policy, timezone: "bad/zone" }, { ...policy, approved: true }])
    assert.deepEqual(codes(register(undefined, undefined, configured)), ["PLAYER_POLICY_PENDING"]);
});
test("un reloj inválido no habilita un alta", () => {
  assert.deepEqual(codes(register(undefined, "invalid")), ["INVALID_CLOCK"]);
});
test("la baja no depende de edad, política o día de alta", () => {
  assert.deepEqual(evaluatePlayerMovement({ operation: "WITHDRAW" }), { status: "RULES_SATISFIED", blockers: [] });
});
test("un código de trámite desconocido falla de forma cerrada", () => {
  assert.deepEqual(codes(evaluatePlayerMovement({ operation: "OTHER" } as unknown as PlayerMovementInput)), ["INVALID_OPERATION"]);
});


test("PDGLD-105: límites diarios de Morelia durante 2026", () => {
  for (let day = 0; day < 365; day++) {
    const midnight = new Date(Date.UTC(2026, 0, 1 + day, 6));
    const weekday = new Date(Date.UTC(2026, 0, 1 + day)).getUTCDay();
    for (const offset of [-1, 0]) {
      const expectedDay = offset === -1 ? (weekday + 6) % 7 : weekday;
      assert.equal(register(undefined, new Date(midnight.getTime() + offset).toISOString()).status,
        [1, 2, 3].includes(expectedDay) ? "RULES_SATISFIED" : "BLOCKED");
    }
  }
});
test("PDGLD-105: referencia de temporada independiente del cambio de año", () => {
  const configured = { ...policy, registrationDays: [1, 2, 3, 4, 5, 6, 7] };
  for (const instant of ["2027-01-01T05:59:59.999Z", "2027-01-01T06:00:00.000Z"]) {
    assert.equal(register("2010-12-31", instant, configured).status, "RULES_SATISFIED");
    assert.deepEqual(codes(register("2010-12-31", instant, { ...configured, referenceYear: 2027 })), ["AGE_OUTSIDE_RANGE"]);
  }
});
test("PDGLD-105: fecha bisiesta válida e inválida", () => {
  assert.equal(register("2012-02-29").status, "RULES_SATISFIED");
  assert.deepEqual(codes(register("2011-02-29")), ["INVALID_BIRTH_DATE"]);
});

test("fases: apertura incluida, cierre excluido y huecos cerrados en hora local", () => {
  const configured = { ...policy, registrationWindows: [
    { phase: "Primera", opensAt: "2026-11-02T19:00:00", closesAt: "2026-11-02T21:30:00" },
    { phase: "Segunda", opensAt: "2026-11-04T19:00:00", closesAt: "2026-11-04T21:30:00" },
  ] };
  for (const [instant, permitted] of [
    ["2026-11-03T00:59:59.999Z", false], ["2026-11-03T01:00:00Z", true],
    ["2026-11-03T03:29:59.999Z", true], ["2026-11-03T03:30:00Z", false],
    ["2026-11-04T01:00:00Z", false], ["2026-11-05T01:00:00Z", true],
  ] as const) assert.equal(register(undefined, instant, configured).status === "RULES_SATISFIED", permitted, instant);
});
test("una fase abierta conserva la restricción semanal; vacío mantiene compatibilidad", () => {
  const configured = { ...policy, registrationWindows: [{ phase: "Semana", opensAt: "2026-11-01T00:00:00", closesAt: "2026-11-08T00:00:00" }] };
  assert.deepEqual(codes(register(undefined, "2026-11-05T18:00:00Z", configured)), ["REGISTRATION_WINDOW_CLOSED"]);
  assert.equal(register(undefined, undefined, { ...policy, registrationWindows: [] }).status, "RULES_SATISFIED");
});
test("rechaza fases invertidas, fechas inválidas y fechas UTC en campos locales", () => {
  for (const window of [
    { phase: "Fase", opensAt: "2026-11-03T19:00:00", closesAt: "2026-11-02T19:00:00" },
    { phase: "Fase", opensAt: "2026-02-30T19:00:00", closesAt: "2026-11-02T19:00:00" },
    { phase: "Fase", opensAt: "2026-11-01T19:00:00Z", closesAt: "2026-11-02T19:00:00" },
  ]) assert.deepEqual(codes(register(undefined, undefined, { ...policy, registrationWindows: [window] })), ["PLAYER_POLICY_PENDING"]);
});
