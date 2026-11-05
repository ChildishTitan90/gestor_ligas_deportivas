import { z } from "zod";
import { curpMatchesBirthDate, hasValidCurpStructure, isCalendarDate, normalizeCurp } from "./identity-rules";

const name = z.string().trim().min(1, "Escribe el nombre o apellido.").max(120)
  .regex(/^[\p{L}\p{M} .'-]+$/u, "Usa letras y los separadores del nombre.")
  .refine(value => /\p{L}/u.test(value), "Escribe al menos una letra.")
  .transform(value => value.normalize("NFC").replace(/\s+/g, " "));

export const playerIdentitySchema = z.strictObject({
  curp: z.string().max(64).transform(normalizeCurp)
    .refine(hasValidCurpStructure, "Revisa la estructura y el dígito verificador de la CURP."),
  firstName: name,
  paternalSurname: name,
  maternalSurname: z.union([name, z.literal(""), z.null()]).optional().transform(value => value || null),
  birthDate: z.string().refine(isCalendarDate, "Escribe una fecha real con formato AAAA-MM-DD.")
    .refine(value => value <= new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date()),
      "El nacimiento no puede estar en el futuro."),
}).superRefine((value, context) => {
  if (!curpMatchesBirthDate(value.curp, value.birthDate)) context.addIssue({
    code: "custom", path: ["birthDate"], message: "El nacimiento no coincide con la fecha y el siglo de la CURP.",
  });
});

// Club, liga, temporada y categoría se derivan del equipo inscrito, nunca del navegador.
export const registerPlayerSchema = z.strictObject({
  seasonTeamId: z.uuid(),
  identity: playerIdentitySchema,
});
export type PlayerIdentityInput = z.output<typeof playerIdentitySchema>;
export type RegisterPlayerInput = z.output<typeof registerPlayerSchema>;
