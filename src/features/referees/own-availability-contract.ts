import type { AvailabilityPresentation } from "./types";

export type OwnAvailabilityContext = { leagueId: string; league: string; seasonId: string; season: string; clubId: string; club: string; timezone: string };
export type OwnAvailabilityWorkspace = {
  actorId: string; referee: { id: string; version: number; active: boolean } | null;
  contexts: OwnAvailabilityContext[]; leagueId: string; seasonId: string;
  intervals: AvailabilityPresentation[]; canUpdate: boolean; blockedCode: string | null;
};
