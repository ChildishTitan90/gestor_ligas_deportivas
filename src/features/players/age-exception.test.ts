import assert from "node:assert/strict";
import test from "node:test";
import { ageExceptionCommandSchema, describeAdmissionRule } from "./age-exception";
const id = "00000000-0000-4000-8000-000000000001";
const request = { action: "REQUEST", operationKey: id, documentId: id, fingerprint: "a".repeat(64), reason: "Carta presentada para revisión" };
test("excepción exige motivo, carta, huella y operación; no acepta autoridad del navegador", () => {
  assert.equal(ageExceptionCommandSchema.safeParse(request).success, true);
  for (const value of [{ ...request, reason: "  " }, { ...request, documentId: "" }, { ...request, fingerprint: "invalid" },
    { ...request, approved: true }, { ...request, actorId: id }, { ...request, reason: "a".repeat(1001) }])
    assert.equal(ageExceptionCommandSchema.safeParse(value).success, false);
});
test("aceptar y rechazar requieren la petición exacta y un motivo", () => {
  for (const decision of ["APPROVE", "REJECT"]) {
    const value = { action: "DECIDE", decision, requestId: id, operationKey: id, fingerprint: "b".repeat(64), reason: "Revisión de la carta" };
    assert.equal(ageExceptionCommandSchema.safeParse(value).success, true);
    assert.equal(ageExceptionCommandSchema.safeParse({ ...value, reason: "" }).success, false);
    assert.equal(ageExceptionCommandSchema.safeParse({ ...value, authorizedBy: id }).success, false);
  }
});
test("mensaje explica la configuración real, sin sustituirla por lunes a miércoles", () => {
  const message = describeAdmissionRule({ referenceYear: 2027, minimumAge: 14, maximumAge: 16, exceptionMinimumAge: 13,
    registrationDays: [4, 6], timezone: "UTC" });
  assert.match(message, /2027/); assert.match(message, /jueves, sábado \(UTC\)/); assert.match(message, /13 años/);
  assert.doesNotMatch(message, /lunes/);
});
