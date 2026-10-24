/** Presentación de inscripciones; no define el futuro contrato HTTP de PDGLD-62. */
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
