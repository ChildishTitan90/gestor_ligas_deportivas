import type { AffiliationFormValues } from "./schemas";

export type AffiliationCategoryOption = {
  id: string;
  name: string;
};

// Lo proporciona la página desde el servidor.
// Estos datos no sustituyen la autorización de los endpoints.
export type AffiliationSubmissionContext = {
  actorId: string;
  clubId: string;
  seasonId: string;
  storageOrigin: string;
};

export type AffiliationFormProps = {
  categories: readonly AffiliationCategoryOption[];
  initialValues?: AffiliationFormValues;
  submissionContext?: AffiliationSubmissionContext;
  correction?: {
    id: string;
    submissionKey: string;
    expectedVersion: number;
    referenceNumber: string;
    observations: string;
    signatureFileIds: Partial<Record<"PRESIDENT" | "SECRETARY" | "TREASURER", string>>;
  };
};

export type AffiliationFieldErrors = Record<string, string>;
