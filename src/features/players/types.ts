/** Contrato mínimo para PDGLD-14/15. Los identificadores no conceden acceso. */
export type PlayerRegistrationContext = {
  personId: string;
  registrationId: string;
  seasonTeamId: string;
  teamId: string;
  clubId: string;
  leagueId: string;
  seasonId: string;
  seasonCategoryId: string;
  categoryId: string;
  groupId: string;
  status: string;
  /** null identifica filas históricas aún no evaluadas por este servicio. */
  identityReviewStatus: "NOT_REQUIRED" | "REQUIRED" | null;
};

export type RegisterPlayerResult = PlayerRegistrationContext & {
  localValidation: "VALID";
  externalVerification: "NOT_PERFORMED";
  replayed: boolean;
};

export type PlayerTeamOption = {
  id: string; teamName: string; clubId: string; clubName: string; seasonId: string; seasonName: string;
  categoryName: string; groupName: string;
};
export type PlayerListItem = {
  registrationId: string; displayName: string; status: string; identityReviewStatus: string | null;
  seasonTeamId?:string; teamName?:string; clubName?:string; seasonName?:string;
};
