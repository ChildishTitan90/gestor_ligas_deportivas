import { z } from "zod";
import { uniformKitsSchema } from "./uniform-kits";

export const affiliationOfficeCodes = ["PRESIDENT", "SECRETARY", "TREASURER"] as const;

const requiredText = z.string().trim().min(1, "Este campo es obligatorio.");

const officerSchema = z.strictObject({
  firstName: requiredText,
  paternalSurname: requiredText,
  maternalSurname: z.string().trim(),
});

// Contrato de captura local, no de envío ni persistencia de una solicitud.
// Las firmas y el contexto autorizado se integrarán con PDGLD-57/59.
export const affiliationFormSchema = z.strictObject({
  clubName: requiredText,
  uniformColors: requiredText,
  uniformKits: uniformKitsSchema.optional(),
  categoryIds: z.array(requiredText).min(1, "Selecciona al menos una categoría.")
    .refine((ids) => new Set(ids).size === ids.length, "No repitas categorías."),
  officers: z.strictObject({
    PRESIDENT: officerSchema,
    SECRETARY: officerSchema,
    TREASURER: officerSchema,
  }),
});

export type AffiliationFormValues = z.infer<typeof affiliationFormSchema>;
