import type { StandingRow } from './calculation';

export type StandingFilters = { competitionId?: string; seasonId?: string; categoryId?: string; groupId?: string; matchdayId?: string };
export type StandingCatalog = {
  competitions: { id: string; name: string }[];
  seasons: { id: string; competitionId: string; name: string }[];
  categories: { id: string; seasonId: string; name: string }[];
  groups: { id: string; categoryId: string; name: string }[];
};
export type StandingTable = {
  groupName: string;
  matchday: number;
  ruleVersion: number;
  version: number | null;
  status: 'VALIDATED' | 'CALCULATED' | 'PREVIEW';
  latestStoredVersion: number | null;
  calculatedAt: string | null;
  officialResults: number;
  sources: { label: string; count: number }[];
  rows: (Omit<StandingRow, 'unresolved'> & { teamName: string })[];
};
export type StandingWorkspace = {
  catalog: StandingCatalog;
  filters: StandingFilters;
  matchdays: { id: string; number: number }[];
  table: StandingTable | null;
  state: 'select' | 'no-matchdays' | 'rules-pending' | 'ready';
};
