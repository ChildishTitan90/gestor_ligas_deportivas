import type { AffiliationFormValues } from "./schemas";

// Opciones de presentación proporcionadas por quien monta el formulario.
// No representan un catálogo oficial ni una autorización del servidor.
export type AffiliationCategoryOption = { id: string; name: string };

export type AffiliationFormProps = {
  categories: readonly AffiliationCategoryOption[];
  initialValues?: AffiliationFormValues;
};

export type AffiliationFieldErrors = Record<string, string>;
