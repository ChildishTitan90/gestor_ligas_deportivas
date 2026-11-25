import assert from "node:assert/strict";
import test from "node:test";
import { transitionSchema, matchStatuses } from "./schemas";
import { assertTransition, assertReplay, receiptDto, type MatchSnapshot, type TransitionReceipt } from "./transition-rules";

const input = { matchId: "13200000-0000-4000-8000-000000000001", operationId: "13200000-0000-4000-8000-000000000002",
  expectedVersion: 1, toStatus: "SCHEDULED" as const, reason: "Programación inicial" };
const snapshot: MatchSnapshot = { status: "DRAFT", version: 1, deleted: false, seasonStatus: "ACTIVE", venueId: "venue",
  startsAt: new Date("2026-11-14T10:00:00Z"), endsAt: new Date("2026-11-14T11:00:00Z"), reservedUntil: new Date("2026-11-14T11:15:00Z") };

test("contrato: exige motivo, UUID y versión válidos; rechaza actor/rol del navegador", () => {
  assert.equal(transitionSchema.parse({ ...input, reason: "  Programa  " }).reason, "Programa");
  for (const patch of [{ reason: " " }, { reason: "x".repeat(501) }, { expectedVersion: 0 },
    { expectedVersion: 1.2 }, { expectedVersion: 2147483647 }, { operationId: "bad" },
    { toStatus: "PROGRAMADO" }, { actorId: input.matchId }, { role: "SCHEDULER" }])
    assert.equal(transitionSchema.safeParse({ ...input, ...patch }).success, false);
});

test("programar exige cancha y un intervalo completo con holgura válida", () => {
  assert.doesNotThrow(() => assertTransition(snapshot, input));
  for (const patch of [{ venueId: null }, { startsAt: null }, { endsAt: null }, { reservedUntil: null },
    { endsAt: snapshot.startsAt }, { reservedUntil: snapshot.startsAt }, { startsAt: new Date(NaN) }])
    assert.throws(() => assertTransition({ ...snapshot, ...patch }, input), { code: "SCHEDULE_REQUIRED" });
});

test("no cambia una versión obsoleta, baja lógica ni temporada cerrada", () => {
  assert.throws(() => assertTransition({ ...snapshot, version: 2 }, input), { code: "STALE_MATCH" });
  assert.throws(() => assertTransition({ ...snapshot, deleted: true }, input), { code: "MATCH_UNAVAILABLE" });
  assert.throws(() => assertTransition({ ...snapshot, seasonStatus: "CLOSED" }, input), { code: "SEASON_CLOSED" });
});

test("denegación por defecto: no permite otros caminos ni reabrir FINALIZADO", () => {
  for (const status of matchStatuses.filter(status => status !== "DRAFT"))
    assert.throws(() => assertTransition({ ...snapshot, status }, input), { code: "TRANSITION_NOT_IMPLEMENTED" });
  for (const toStatus of matchStatuses.filter(status => status !== "SCHEDULED"))
    assert.throws(() => assertTransition(snapshot, { ...input, toStatus }), { code: "TRANSITION_NOT_IMPLEMENTED" });
});

test("caminos de confirmación, arbitraje y cancelación respetan el estado de origen", () => {
  for (const [from, to] of [["SCHEDULED", "CONFIRMED"], ["CONFIRMED", "IN_PROGRESS"],
    ["IN_PROGRESS", "SUSPENDED"], ["SCHEDULED", "CANCELED"], ["CONFIRMED", "CANCELED"], ["SUSPENDED", "CANCELED"]] as const)
    assert.doesNotThrow(() => assertTransition({ ...snapshot, status: from }, { ...input, toStatus: to }));
  for (const toStatus of matchStatuses)
    assert.throws(() => assertTransition({ ...snapshot, status: "FINISHED" }, { ...input, toStatus }), { code: "TRANSITION_NOT_IMPLEMENTED" });
});

test("reenvío exige el mismo actor y contenido; el acuse representa la versión aplicada", () => {
  const receipt: TransitionReceipt = { id: input.operationId, matchId: input.matchId, actorId: "actor", fromStatus: "DRAFT",
    toStatus: "SCHEDULED", expectedVersion: 1, reason: input.reason, createdAt: new Date("2026-11-12T10:00:00Z") };
  assert.doesNotThrow(() => assertReplay(receipt, "actor", input));
  for (const patch of [{ matchId: "other" }, { actorId: "other" }, { expectedVersion: 2 },
    { expectedVersion: null }, { fromStatus: "FINISHED" }, { toStatus: "CANCELED" }, { reason: "otro" }])
    assert.throws(() => assertReplay({ ...receipt, ...patch }, "actor", input), { code: "IDEMPOTENCY_CONFLICT" });
  assert.deepEqual(receiptDto(receipt, true), { operationId: input.operationId, matchId: input.matchId,
    toStatus: "SCHEDULED", appliedVersion: 2, occurredAt: "2026-11-12T10:00:00.000Z", replayed: true });
});
