/** Presentación de inscripciones, separada del contrato HTTP de PDGLD-62. */
export type TeamRegistrationStatus = "REGISTERED" | "ACTIVE" | "WITHDRAWN";

export type TeamRegistrationItem = {
  /** teams.id: identidad del equipo, compartida entre temporadas. */
  teamId: string;
  /** season_teams.id: identidad de una inscripción concreta. */
  seasonTeamId: string;
  teamName: string;
  seasonName: string;
  categoryName: string;
  groupName: string;
  status: TeamRegistrationStatus;
};

/** Opciones de presentación ya filtradas por el servidor; no son una autorización. */
export type TeamRegistrationOption = { id: string; name: string };
export type TeamRegistrationFormOptions = {
  clubs: readonly (TeamRegistrationOption & {
    seasons: readonly (TeamRegistrationOption & {
      canCreateTeam: boolean;
      teams: readonly TeamRegistrationOption[];
      categories: readonly (TeamRegistrationOption & { groups: readonly TeamRegistrationOption[] })[];
    })[];
  })[];
};

/** Captura validada para un callback local. No es el JSON HTTP: el adaptador lo convierte a team.mode. */
export type TeamRegistrationSubmission = {
  clubId: string;
  seasonId: string;
  categoryId: string;
  groupId: string;
  team: { kind: "existing"; id: string } | { kind: "new"; name: string };
};
export type TeamRegistrationField = "clubId" | "seasonId" | "teamMode" | "teamId" | "teamName" | "categoryId" | "groupId";

/** Resultado interno del integrador, no DTO HTTP. confirmed exige persistencia comprobada. */
export type TeamRegistrationResult =
  | { kind: "confirmed"; teamId: string; seasonTeamId: string; status: TeamRegistrationStatus; replayed?: boolean }
  | { kind: "correctable"; fieldErrors?: Partial<Record<TeamRegistrationField, string>>; message?: string }
  | { kind: "unconfirmed"; retryAllowed?: boolean; message?: string };
export type TeamRegistrationSubmit = (capture: TeamRegistrationSubmission) => Promise<TeamRegistrationResult>;
