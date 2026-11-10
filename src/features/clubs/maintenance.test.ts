import assert from "node:assert/strict";
import test from "node:test";
import { effectiveStatus, maintenanceSchema } from "./maintenance";

test("el estado efectivo mantiene una baja individual después de reactivar el club", () => {
  assert.equal(effectiveStatus("ACTIVE", "INACTIVE"), "Bloqueado por baja del club");
  assert.equal(effectiveStatus("INACTIVE", "INACTIVE"), "Bloqueado por baja del club");
  assert.equal(effectiveStatus("INACTIVE", "ACTIVE"), "Baja temporal");
  assert.equal(effectiveStatus("ACTIVE", "ACTIVE"), "Activo");
});
test("una baja no permite introducir cambios de nombre ni autoridad en el payload", () => {
  const input = { kind: "team", id: "a5c9941a-bc4c-4c09-83ab-9d2e2e1b5b2f", version: 1, operation: "deactivate", reason: "Receso temporal", confirmed: true };
  assert.ok(maintenanceSchema.safeParse(input).success);
  assert.ok(!maintenanceSchema.safeParse({ ...input, name: "Otro" }).success);
  assert.ok(!maintenanceSchema.safeParse({ ...input, actorId: input.id }).success);
  assert.ok(!maintenanceSchema.safeParse({ ...input, confirmed: false }).success);
});
