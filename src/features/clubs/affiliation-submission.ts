import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.uuid().transform((id) => id.toLowerCase());
const officer = z.strictObject({
  firstName: text(120),
  paternalSurname: text(120),
  maternalSurname: z.string().trim().max(120),
  signatureFileId: uuid,
});

/** Contrato de envío: distinto de la captura local de PDGLD-58. */
export const affiliationSubmissionSchema = z.strictObject({
  // UUID generado una vez por envío y reutilizado si se pierde la respuesta.
  submissionKey: uuid,
  clubId: uuid,
  seasonId: uuid,
  clubName: text(200),
  uniformColors: text(200),
  // categories.id, verificadas contra season_categories en servidor.
  categoryIds: z.array(uuid).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length),
  officers: z.strictObject({ PRESIDENT: officer, SECRETARY: officer, TREASURER: officer }),
});

export type AffiliationSubmission = z.infer<typeof affiliationSubmissionSchema>;

/** Orden estable: cambiar el orden de categorías no cambia la operación. */
export function canonicalAffiliationSubmission(data: AffiliationSubmission): string {
  return JSON.stringify({
    clubId: data.clubId, seasonId: data.seasonId,
    clubName: data.clubName, uniformColors: data.uniformColors,
    categoryIds: [...data.categoryIds].sort(),
    officers: ["PRESIDENT", "SECRETARY", "TREASURER"].map((office) => {
      const person = data.officers[office as keyof typeof data.officers];
      return [office, person.firstName, person.paternalSurname, person.maternalSurname, person.signatureFileId];
    }),
  });
}
