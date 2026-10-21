export type AccountCreationOptions = {
  roles: { code: string; name: string }[];
  leagues: { id: string; name: string }[];
  clubs: { id: string; name: string; reference_number: string }[];
};
export type AccountFormData = {
  options: AccountCreationOptions;
  canReusePerson: boolean;
  createClubLeagues: string[];
};
