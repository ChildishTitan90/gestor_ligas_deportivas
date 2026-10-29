import { z } from "zod";

/** Fechas de calendario de la edición; PV-04 define las ventanas de jugadores. */
export const createSeasonSchema = z.strictObject({
  leagueId: z.uuid(),
  name: z.string().trim().min(1).max(160),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
}).refine(data => data.endDate >= data.startDate, {
  path: ["endDate"], message: "La fecha final debe ser igual o posterior al inicio.",
});

/** Propuesta explícita; crear un borrador no acredita validación de negocio. */
export const ruleDraftSchema = z.strictObject({
  expectedSeasonVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
  announcement: z.string().trim().min(1).max(12000),
  points: z.strictObject({ win: z.number().int(), draw: z.number().int(), loss: z.number().int() }),
  tieBreakers: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).min(1).max(20)
    .refine(values => new Set(values).size === values.length, "No repitas criterios de desempate."),
  calendar: z.strictObject({
    rounds: z.number().int().positive(),
    matchDurationMinutes: z.number().int().positive(),
  }),
});

export const categoryCatalogSchema = z.strictObject({
  leagueId: z.uuid(), name: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(1000),
});
export const associateCategorySchema = z.strictObject({
  categoryId: z.uuid(), ruleId: z.uuid(), expectedSeasonVersion: z.number().int().positive(),
  hierarchyOrder: z.number().int().positive(), type: z.enum(["OPEN", "YOUTH", "VETERANS"]),
  reason: z.string().trim().min(1).max(1000),
});
