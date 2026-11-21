import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { openIncidentCases } from "./incident-cases";
import type { ConfirmationContext } from "./confirmation-effects";

const context: ConfirmationContext = { actorId: "actor", matchId: "match", reportId: "report", operationId: "operation", expectedMatchVersion: 1, homeScore: 0, awayScore: 0,
  eventIds: ["yellow1", "yellow2", "red", "serious", "goal"],
  dismissals: [{ eventId: "yellow2", playerId: "player", teamId: "team", reason: "SECOND_CAUTION" }, { eventId: "red", playerId: "other", teamId: "team", reason: "DIRECT_RED" }] };
function fixture() {
  const events = ["CAUTION", "CAUTION", "SENDING_OFF", "SERIOUS_INCIDENT", "GOAL"].map((code, i) => ({ id: context.eventIds[i], description: code === "SERIOUS_INCIDENT" ? "Incidente descrito" : "", event_types: { code } }));
  const writes: Array<{ data: { event_id: string; reference_number: string; description: string }[]; skipDuplicates: boolean }> = [];
  const report = { match_id: "match", matches: { season_id: "season" }, match_events: events };
  const tx = { match_reports: { findUnique: async () => report }, disciplinary_cases: { createMany: async (data: typeof writes[number]) => { writes.push(data); } } } as unknown as Prisma.TransactionClient;
  return { tx, report, writes };
}
test("abre expediente por expulsiones e incidente grave, sin sanción ni amarilla aislada", async () => {
  const { tx, writes } = fixture();
  await openIncidentCases(tx, context);
  assert.deepEqual(writes[0].data.map(row => row.event_id), ["yellow2", "red", "serious"]);
  assert.equal(writes[0].data[0].reference_number, "CEDULA-yellow2");
  assert.match(writes[0].data[2].description, /Incidente descrito/);
  assert.equal(writes[0].skipDuplicates, true);
});
test("rechaza eventos ajenos, partidos distintos e incidentes graves sin descripción", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.report.match_id = "another"; },
    (f: ReturnType<typeof fixture>) => { f.report.match_events[0].id = "another"; },
    (f: ReturnType<typeof fixture>) => { f.report.match_events[3].description = "  "; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(openIncidentCases(f.tx, context));
    assert.equal(f.writes.length, 0);
  }
});
