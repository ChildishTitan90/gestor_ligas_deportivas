import type { RefereePreviewData } from "./types";

/** Solo la consulta de desarrollo carga este fixture; ningún dato proviene de personas reales. */
export const refereePreviewData: RefereePreviewData = {
  source: "SYNTHETIC",
  leagues: [
    { id: "DEMO-L1", name: "Municipal · DEMO", timezone: "America/Mexico_City" },
    { id: "DEMO-L2", name: "Regional · DEMO", timezone: "America/Mexico_City" },
  ],
  seasons: [
    { id: "DEMO-S1", leagueId: "DEMO-L1", name: "Apertura 2026 · DEMO", closed: false },
    { id: "DEMO-S0", leagueId: "DEMO-L1", name: "Clausura 2025 · DEMO · Cerrada", closed: true },
    { id: "DEMO-S2", leagueId: "DEMO-L2", name: "Regional 2026 · DEMO", closed: false },
  ],
  clubs: [
    { id: "DEMO-C1", seasonId: "DEMO-S1", name: "Brisas", code: "D-BRI", registeredTeams: 5 },
    { id: "DEMO-C2", seasonId: "DEMO-S1", name: "Cedro", code: "D-CED", registeredTeams: 4 },
    { id: "DEMO-C3", seasonId: "DEMO-S1", name: "Roble", code: "D-ROB", registeredTeams: 9 },
    { id: "DEMO-C4", seasonId: "DEMO-S1", name: "Faro", code: "D-FAR", registeredTeams: 0 },
  ],
  people: [
    { id: "DEMO-P1", label: "Alba · Persona sintética", reference: "D-P01" },
    { id: "DEMO-P2", label: "Bruna · Persona sintética", reference: "D-P02" },
    { id: "DEMO-P3", label: "Ciro · Persona sintética", reference: "D-P03" },
    { id: "DEMO-P4", label: "Dara · Persona sintética", reference: "D-P04" },
    { id: "DEMO-P5", label: "Elio · Persona sintética", reference: "D-P05" },
    { id: "DEMO-P6", label: "Fina · Persona sintética", reference: "D-P06" },
  ],
  referees: [
    { id: "DEMO-R1", personId: "DEMO-P1", name: "Alba", active: true },
    { id: "DEMO-R2", personId: "DEMO-P2", name: "Bruna", active: false },
    { id: "DEMO-R3", personId: "DEMO-P3", name: "Ciro", active: true },
    { id: "DEMO-R4", personId: "DEMO-P4", name: "Dara", active: true },
    { id: "DEMO-R5", personId: "DEMO-P5", name: "Elio", active: true },
  ],
  links: [
    { refereeId: "DEMO-R1", seasonId: "DEMO-S1", clubId: "DEMO-C1" },
    { refereeId: "DEMO-R2", seasonId: "DEMO-S1", clubId: "DEMO-C3" },
    { refereeId: "DEMO-R3", seasonId: "DEMO-S1", clubId: "DEMO-C1" },
    { refereeId: "DEMO-R4", seasonId: "DEMO-S1", clubId: "DEMO-C1" },
    { refereeId: "DEMO-R5", seasonId: "DEMO-S1", clubId: "DEMO-C2" },
  ],
  availability: [
    ...["DEMO-R1", "DEMO-R2", "DEMO-R3", "DEMO-R4", "DEMO-R5"].map((refereeId, n) => ({
      id: `DEMO-V${n}`, refereeId, startsAt: "2026-11-21T14:00:00Z", endsAt: "2026-11-22T02:00:00Z", available: true,
    })),
    { id: "DEMO-V5", refereeId: "DEMO-R3", startsAt: "2026-11-21T16:00:00Z", endsAt: "2026-11-21T18:00:00Z", available: false },
  ],
  matches: [
    { id: "DEMO-M1", number: "D-101", seasonId: "DEMO-S1", category: "Libre", group: "A", home: "Roble A", away: "Faro A", venue: "Cancha Norte · DEMO",
      startsAt: "2026-11-21T16:00:00Z", endsAt: "2026-11-21T18:00:00Z",
      groupClubs: [{ clubId: "DEMO-C3", team: "Roble A" }, { clubId: "DEMO-C4", team: "Faro A" }, { clubId: "DEMO-C2", team: "Cedro C" }] },
    { id: "DEMO-M2", number: "D-102", seasonId: "DEMO-S1", category: "Libre", group: "B", home: "Roble B", away: "Faro B", venue: "Cancha Sur · DEMO",
      startsAt: "2026-11-21T17:00:00Z", endsAt: "2026-11-21T19:00:00Z",
      groupClubs: [{ clubId: "DEMO-C3", team: "Roble B" }, { clubId: "DEMO-C4", team: "Faro B" }] },
    { id: "DEMO-M3", number: "D-103", seasonId: "DEMO-S1", category: "Juvenil", group: "Único", home: "Roble J", away: "Faro J", venue: "Cancha Centro · DEMO",
      startsAt: "2026-11-21T20:00:00Z", endsAt: "2026-11-21T22:00:00Z",
      groupClubs: [{ clubId: "DEMO-C1", team: "Brisas J" }, { clubId: "DEMO-C2", team: "Cedro J" }, { clubId: "DEMO-C3", team: "Roble J" }, { clubId: "DEMO-C4", team: "Faro J" }] },
    { id: "DEMO-M4", number: "D-104", seasonId: "DEMO-S1", category: "Libre", group: "C", home: "Roble C", away: "Faro C", venue: "Cancha Oriente · DEMO",
      startsAt: "2026-11-21T18:00:00Z", endsAt: "2026-11-21T20:00:00Z",
      groupClubs: [{ clubId: "DEMO-C3", team: "Roble C" }, { clubId: "DEMO-C4", team: "Faro C" }] },
  ],
  assignments: [
    { id: "DEMO-A1", matchId: "DEMO-M1", refereeId: "DEMO-R1", status: "PROPOSED" },
    { id: "DEMO-A2", matchId: "DEMO-M1", refereeId: "DEMO-R2", status: "PROPOSED" },
    { id: "DEMO-A3", matchId: "DEMO-M1", refereeId: "DEMO-R3", status: "PROPOSED" },
    { id: "DEMO-A4", matchId: "DEMO-M2", refereeId: "DEMO-R4", status: "APPROVED" },
    { id: "DEMO-A5", matchId: "DEMO-M1", refereeId: "DEMO-R4", status: "PROPOSED" },
    { id: "DEMO-A6", matchId: "DEMO-M1", refereeId: "DEMO-R5", status: "PROPOSED" },
    { id: "DEMO-A7", matchId: "DEMO-M2", refereeId: "DEMO-R3", status: "REVOKED" },
    { id: "DEMO-A8", matchId: "DEMO-M4", refereeId: "DEMO-R1", status: "APPROVED" },
  ],
  history: [
    { id: "DEMO-H1", refereeId: "DEMO-R1", matchId: "DEMO-OLD1", matchLabel: "D-021 · Brisas – Roble", seasonId: "DEMO-S0", status: "APPROVED", occurredAt: "2025-12-07T16:00:00Z",
      identity: { source: "SEASON_CLOSURE_V1", label: "Alba · Identidad al cierre DEMO", capturedAt: "2025-12-31T18:00:00Z", identityVersion: 1 } },
    { id: "DEMO-H2", refereeId: "DEMO-R3", matchId: "DEMO-OLD2", matchLabel: "D-022 · Faro – Cedro", seasonId: "DEMO-S0", status: "REVOKED", occurredAt: "2025-12-07T18:00:00Z", identity: { source: "UNAVAILABLE" } },
  ],
};
