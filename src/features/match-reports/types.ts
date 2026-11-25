/** Contratos de presentación serializables. No son entradas confiables de persistencia. */
import type { UniformKits } from "@/features/clubs/uniform-kits";
import type { TeamTactics } from "./tactics";
import type { MatchClock } from "./match-clock";
import type { NoShow } from "./no-show";
export type ReportTeam = { id: string; name: string; shortName: string; initials: string; uniformKits?: UniformKits | null };
export type ReportPlayer = {
  id: string;
  teamId: string;
  name: string;
  usualJersey: number | null;
  eligible: boolean;
  blockers: { code: string; message: string }[];
  halfReservation?: boolean;
  halfRestriction?: 1 | 2;
  photoUrl?: string | null;
};
export type ParticipationPeriod = { periodNumber: number; entryMinute: number | null; exitMinute: number | null };
export type ReportLineup = {
  playerId: string;
  selected: boolean;
  starter: boolean;
  matchJersey: number | null;
  periods: ParticipationPeriod[];
  participationHalf?: 1 | 2;
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
  second?: number | null;
  /** Captura con reloj: minuto relativo al periodo para participación y orden. */
  periodMinute?: number;
  description: string;
  replacementCaptainId?: string | null;
};
export type CaptainSignature = {
  captainId: string;
  image: string;
  fileId?: string;
  source: "device" | "synthetic";
};
export type MatchReportPresentation = {
  id: string;
  matchId: string;
  version: number;
  status: "DRAFT" | "CONFIRMED";
  lineups: ReportLineup[];
  persistedLineupOrder?: string[];
  captains: Record<string, string>;
  events: ReportEvent[];
  score: { home: number | null; away: number | null };
  remarks: string;
  incidents: string;
  signatures: Record<string, CaptainSignature | null>;
  confirmedAt: string | null;
  tactics?: Record<string, TeamTactics>;
  lineupsLock?: { operationId: string; lockedAt: string } | null;
  clock?: MatchClock | null;
  noShow?: NoShow;
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
export type ReportDemoCase = "setup" | "clock-due" | "draft" | "empty" | "confirmed" | "denied" | "loading" | "error" | "stale" | "uncertain" | "scheduled";
export type ReportDemoData = {
  confirmation?: { available: boolean; message: string };
  match: ReportMatchPresentation;
  players: ReportPlayer[];
  eventTypes: ReportEventType[];
  report: MatchReportPresentation;
  scenario: ReportDemoCase;
};
