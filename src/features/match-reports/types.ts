/** Contratos de presentación serializables. No son entradas confiables de persistencia. */
export type ReportTeam = { id: string; name: string; shortName: string; initials: string };
export type ReportPlayer = {
  id: string;
  teamId: string;
  name: string;
  usualJersey: number | null;
  eligible: boolean;
  blockers: { code: string; message: string }[];
};
export type ParticipationPeriod = { periodNumber: number; entryMinute: number | null; exitMinute: number | null };
export type ReportLineup = {
  playerId: string;
  selected: boolean;
  starter: boolean;
  matchJersey: number | null;
  periods: ParticipationPeriod[];
};
export type ReportEventType = {
  code: string;
  label: string;
  player: "required" | "optional";
  team: "required" | "optional";
  opensCase: boolean;
};
export type ReportEvent = {
  id: string;
  typeCode: string;
  teamId: string | null;
  playerId: string | null;
  outgoingPlayerId: string | null;
  periodNumber: number | null;
  minute: number | null;
  description: string;
};
export type CaptainSignature = {
  captainId: string;
  image: string;
  source: "device" | "synthetic";
};
export type MatchReportPresentation = {
  id: string;
  matchId: string;
  version: number;
  status: "DRAFT" | "CONFIRMED";
  lineups: ReportLineup[];
  captains: Record<string, string>;
  events: ReportEvent[];
  score: { home: number | null; away: number | null };
  remarks: string;
  incidents: string;
  signatures: Record<string, CaptainSignature | null>;
  confirmedAt: string | null;
};
export type ReportMatchPresentation = {
  id: string;
  number: string;
  version: number;
  status: { code: string; label: string; captureAllowed: boolean };
  season: string;
  category: string;
  group: string;
  matchday: string;
  venue: string;
  startsAt: string;
  home: ReportTeam;
  away: ReportTeam;
};
export type ReportDemoCase = "draft" | "empty" | "confirmed" | "denied" | "loading" | "error" | "stale" | "uncertain" | "scheduled";
export type ReportDemoData = {
  match: ReportMatchPresentation;
  players: ReportPlayer[];
  eventTypes: ReportEventType[];
  report: MatchReportPresentation;
  scenario: ReportDemoCase;
};
