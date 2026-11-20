import test from "node:test";
import assert from "node:assert/strict";
import { authorizedHomeAssignment, calendarMatchdays, candidateStarts, firstCandidate, participationBlocked } from "./constraints";
import { schedulingPolicySchema } from "./schemas";

test("sanción temporal bloquea solo al equipo afectado y durante su vigencia", () => {
  const blocks = [{ season_team_id: "a", starts_at: new Date(100), ends_at: new Date(200) }];
  assert.equal(participationBlocked(blocks, ["a", "b"], 0, 100), false);
  assert.equal(participationBlocked(blocks, ["a", "b"], 200, 300), false);
  assert.equal(participationBlocked(blocks, ["a", "b"], 50, 150), true);
  assert.equal(participationBlocked(blocks, ["a", "b"], 100, 200), true);
  assert.equal(participationBlocked(blocks, ["c", "d"], 100, 200), false);
  assert.equal(participationBlocked([{ ...blocks[0], ends_at: null }], ["a"], 300, 400), true);
});

test("grupos de distinto tamaño aprovechan jornadas de una misma temporada", () => {
  const days = Array.from({ length: 9 }, (_, i) => ({ number: i + 1,
    start_date: new Date(i * 7 * 86400000), end_date: new Date((i * 7 + 1) * 86400000) }));
  assert.equal(calendarMatchdays(days, 3)?.length, 3);
  assert.equal(calendarMatchdays(days, 9)?.length, 9);
  assert.equal(calendarMatchdays(days, 10), null);
  assert.equal(calendarMatchdays([days[0], days[2]], 2), null);
  assert.equal(calendarMatchdays([days[0], { ...days[1], start_date: days[0].end_date }], 2), null);
});

test("una apertura a las 09:10 admite ese inicio aunque el paso sea de 30 minutos", () => {
  const opening = Date.parse("2026-11-22T09:10:00-06:00"), step = 30 * 60000;
  assert.equal(firstCandidate(opening, opening - 60000, step), opening);
  assert.equal(firstCandidate(opening, opening + 60000, step), opening + step);
});

test("horarios asignados fuera de la cuadrícula se incluyen una vez y dentro de la apertura", () => {
  assert.deepEqual([...candidateStarts(0, 0, 100, 30, [-10, 10, 10, 60, 100])], [0, 10, 30, 60, 90]);
  assert.deepEqual([...candidateStarts(0, 45, 100, 30, [10, 50, 60])], [50, 60, 90]);
});

test("tramos de canchas explícitos no admiten superposición ni canchas repetidas", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const stage = { fromRound: 3, toRound: 5, venueIds: [id] };
  assert.equal(schedulingPolicySchema.safeParse({ slotStepMinutes: 30, venueStages: [stage] }).success, true);
  assert.equal(schedulingPolicySchema.safeParse({ slotStepMinutes: 30,
    venueStages: [stage, { ...stage, fromRound: 5, toRound: 7 }] }).success, false);
  assert.equal(schedulingPolicySchema.safeParse({ slotStepMinutes: 30,
    venueStages: [{ ...stage, venueIds: [id, id] }] }).success, false);
});

test("cancha compartida exige autorización del local para esa cancha y temporada", () => {
  const assignment = { season_team_id: "a", venue_id: "shared", weekday: 7,
    start_time: new Date("1970-01-01T09:00:00Z"), starts_at: new Date("2026-11-01"), ends_at: new Date("2026-11-30"),
    venue_loans: { status: "APPROVED", season_id: "season", club_id: "club-a", venue_id: "shared",
      approved_by: "reviewer", approved_at: new Date("2026-10-31") } };
  const context = { teamId: "a", clubId: "club-a", seasonId: "season", venueId: "shared",
    localStart: "2026-11-22T09:00:00", localEnd: "2026-11-22T11:00:00" };
  assert.equal(authorizedHomeAssignment([assignment], context), true);
  assert.equal(authorizedHomeAssignment([assignment], { ...context, teamId: "b", clubId: "club-b" }), false);
  const other = { ...assignment, season_team_id: "b", venue_loans: { ...assignment.venue_loans, club_id: "club-b" } };
  assert.equal(authorizedHomeAssignment([assignment, other], { ...context, teamId: "b", clubId: "club-b" }), true);
  for (const change of [{ status: "PENDING" }, { season_id: "other" }, { venue_id: "other" }, { approved_by: null }]) {
    assert.equal(authorizedHomeAssignment([{ ...assignment, venue_loans: { ...assignment.venue_loans, ...change } }], context), false);
  }
  assert.equal(authorizedHomeAssignment([assignment], { ...context, localEnd: "2026-12-01T00:15:00" }), false);
});
