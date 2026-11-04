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

export type DelegatePosition = "PRIMARY" | "DEPUTY";
export type DelegatePeriod = { startsAt: string; endsAt: string | null };
export type DelegateAssignmentOptions = {
  period: DelegatePeriod;
  positions: { value: DelegatePosition; label: string; available: boolean;
    reason: "OCCUPIED" | "LEGACY" | null }[];
};
