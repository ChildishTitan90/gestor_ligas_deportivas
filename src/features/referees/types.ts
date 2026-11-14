/** DTOs de presentación. No importan Prisma, sesión ni datos privados.
 * Los identificadores DEMO no son identificadores válidos para escrituras. */
export type AssignmentStatus = "PROPOSED" | "APPROVED" | "REVOKED";
export type RefereeView = "register" | "availability" | "quota" | "assignments" | "history";
export type PreviewState = "ready" | "loading" | "empty" | "error" | "denied";
export type LeagueOption = { id: string; name: string; timezone: string };
export type SeasonOption = { id: string; leagueId: string; name: string; closed: boolean };
export type ClubPresentation = { id: string; seasonId: string; name: string; code: string; registeredTeams: number; eligible?:boolean; context?:string };
export type PersonOption = { id: string; label: string; reference: string; version?: number };
export type RefereePresentation = { id: string; personId: string; name: string; active: boolean; version?: number };
export type ClubPresentationLink = { refereeId: string; seasonId: string; clubId: string };
export type AvailabilityPresentation = { id: string; refereeId: string; startsAt: string; endsAt: string; available: boolean };
export type MatchPresentation = {
  id: string; number: string; seasonId: string; category: string; group: string;
  home: string; away: string; venue: string; startsAt: string; endsAt: string;
  /** Incluye todos los clubes del grupo, aunque no disputen este encuentro. */
  groupClubs: { clubId: string; team: string }[]; version?: number;
};
export type AssignmentPresentation = { id: string; matchId: string; refereeId: string; status: AssignmentStatus; version?: number; displayName?:string; historical?:boolean };
export type AssignmentAssessment = {
  availability: "COVERED" | "UNAVAILABLE" | "UNKNOWN";
  blockers: { code: string; message: string }[];
};
export type HistoryPresentation = {
  id: string; refereeId: string; matchId: string; matchLabel: string; seasonId: string;
  status: AssignmentStatus; occurredAt: string;
  /** Evidencia del cierre, nunca completar un antecedente con la identidad vigente. */
  identity: { source: "SEASON_CLOSURE_V1" | "MATCH_CLOSURE_V1"; label: string; capturedAt: string; identityVersion: number }
    | { source: "UNAVAILABLE" };
};
export type RefereePreviewData = {
  source: "SYNTHETIC" | "DATABASE";
  leagues: LeagueOption[]; seasons: SeasonOption[]; clubs: ClubPresentation[];
  people: PersonOption[]; referees: RefereePresentation[]; links: ClubPresentationLink[];
  availability: AvailabilityPresentation[]; matches: MatchPresentation[];
  assignments: AssignmentPresentation[]; history: HistoryPresentation[];
  events?: { id: string; refereeId: string; assignmentId: string | null; action: string; actor: string; reason: string; at: string; version: number }[];
};
export type LiveRefereeControls = {
  leagueId: string; seasonId: string; pending: boolean; uncertain: boolean; error: string; reason: string;
  capabilities: { register: boolean; update: boolean; approve: boolean; provisionAccess?: boolean };
  assessments: Record<string, AssignmentAssessment>;
  onReasonChange: (reason: string) => void;
  onScopeChange: (league: string, season: string) => void;
  mutate: (command: Record<string, unknown>) => Promise<boolean>;
  recover: () => void;
  retryReady: boolean; retry: () => void;
};

/** Para el backend futuro: assessments, cuotas y capacidades deben proceder del
 * servidor tras autenticar y autorizar liga/temporada/club/partido. Estas vistas
 * no son un contrato de escritura ni acreditan permisos o elegibilidad. */
