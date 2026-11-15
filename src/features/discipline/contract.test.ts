import assert from "node:assert/strict";
import test from "node:test";
import { articleSchema, consequenceSchema } from "./contract";

const example = { number: "DEMO-01", description: "Ejemplo", configuration: { schemaVersion: 1, target: "PLAYER", consequence: { type: "MATCHES", quantity: 2 }, source: { origin: "SYNTHETIC", document: "Ejemplo", season: "Prueba", reference: "Ejemplo", confirmed: false } } };
test("ejemplos no se presentan como reglas oficiales", () => {
  assert.equal(articleSchema.safeParse(example).success, true);
  assert.equal(articleSchema.safeParse({ ...example, number: "1" }).success, false);
  assert.equal(articleSchema.safeParse({ ...example, configuration: { ...example.configuration, source: { ...example.configuration.source, confirmed: true } } }).success, false);
});
test("cada consecuencia exige valores compatibles", () => {
  assert.equal(consequenceSchema.safeParse({ type: "MATCHES", quantity: 0 }).success, false);
  assert.equal(consequenceSchema.safeParse({ type: "TIME", quantity: 1, unit: "DAYS" }).success, true);
  assert.equal(consequenceSchema.safeParse({ type: "FINE", amount: "0.00", currency: "MXN" }).success, false);
  assert.equal(consequenceSchema.safeParse({ type: "FINE", amount: "100.00", currency: "MXN" }).success, true);
  assert.equal(articleSchema.safeParse({ ...example, configuration: { ...example.configuration, consequence: { type: "POINTS_DEDUCTION", quantity: 3 } } }).success, false);
});
