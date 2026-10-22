export type AuthIdentity = {
  id: string;
  mustChangePassword: boolean;
};

/** Presentación de la cuenta propia; nunca se utiliza para autorizar. */
export type AccountPresentation = {
  name: string;
  username: string | null;
  initials: string;
  roleNames: string[];
  assignments: string[];
};

export type CurrentAccount = {
  account: AccountPresentation;
  mustChangePassword: boolean;
};
