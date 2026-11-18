import assert from "node:assert/strict";
import test from "node:test";
import { homeVenueOptions, type HomeVenueCandidate } from "./home-venue";

const time = (hhmm: string) => new Date(`2026-11-16T${hhmm}:00-06:00`);
const slot = (from: string, to: string) => ({ startsAt: time(from), endsAt: time(to) });
const opening = slot("17:00", "20:00");
const context = {
  leagueId: "league", seasonId: "season", homeClubId: "home", awayClubId: "away",
  roundsAfterThis: 10, complexOnlyFinalRounds: 10, startsAt: time("18:00"),
};
const complex: HomeVenueCandidate = {
  id: "complex", leagueId: "league", active: true, kind: "complex",
  durationMinutes: 90, bufferMinutes: 15, openings: [opening], closures: [], loans: [],
};
const loan = { status: "APPROVED", seasonId: "season", clubId: "home", windows: [opening] } as const;
const privateVenue: HomeVenueCandidate = { ...complex, id: "private", kind: "private", loans: [loan] };
const ids = (c: typeof context, ...venues: HomeVenueCandidate[]) =>
  homeVenueOptions(c, venues).map(option => option.venueId);

test("Una particular requiere prestamo aprobado para el club y la temporada", () => {
  for (const candidate of [
    { ...loan, status: "PENDING" as const }, { ...loan, status: "REJECTED" as const },
    { ...loan, seasonId: "other" }, { ...loan, clubId: "other" },
  ]) assert.deepEqual(ids(context, { ...privateVenue, loans: [candidate] }, complex), ["complex"]);
  assert.deepEqual(ids(context, complex, privateVenue), ["private", "complex"]);
  assert.deepEqual(ids(context, { ...privateVenue, leagueId: "other" }), []);
});

test("Las ultimas N jornadas solo admiten unidades deportivas", () => {
  const boundary = { ...context, roundsAfterThis: 9 };
  assert.deepEqual(ids(boundary, privateVenue, complex), ["complex"]);
  assert.deepEqual(ids(boundary, privateVenue), []);
  assert.deepEqual(ids({ ...boundary, complexOnlyFinalRounds: 0 }, privateVenue), ["private"]);
});

test("La cancha rival requiere localia previa y prestamo aprobado", () => {
  const rival = { ...privateVenue, loans: [{ ...loan, clubId: "away" }] };
  assert.deepEqual(ids(context, rival), []);
  assert.equal(homeVenueOptions({ ...context, priorHomeVenueId: rival.id }, [rival])[0]?.source, "RIVAL_LOAN");
});

test("La reserva completa incluye la holgura y respeta los bloqueos", () => {
  const limited = { ...loan, windows: [slot("18:00", "19:30")] };
  assert.deepEqual(ids(context, { ...privateVenue, loans: [limited] }), []);
  assert.deepEqual(ids(context, { ...privateVenue, closures: [slot("19:40", "20:00")] }), []);
  assert.deepEqual(ids(context, { ...privateVenue, openings: [slot("18:00", "19:30")] }), []);
  const [option] = homeVenueOptions(context, [{ ...privateVenue, closures: [slot("19:45", "20:00")] }]);
  assert.equal(option?.reservedUntil.getTime(), time("19:45").getTime());
});