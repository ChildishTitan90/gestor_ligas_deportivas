import { z } from "zod";

/** Datos iniciales de una liga; la autoridad se comprueba en servidor. */
export const createLeagueSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  timezone: z.string().trim().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("es", { timeZone: value }); return true; }
    catch { return false; }
  }, "Selecciona una zona horaria válida."),
  reason: z.string().trim().min(1).max(1000),
});

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
  tieBreakers: z.array(z.string().trim().min(1).max(4000)).min(1).max(20)
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

const groupVersion = { expectedSeasonVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(1000) };
export const configurationDeleteSchema = z.strictObject(groupVersion);
export const seasonCloseSchema = z.strictObject({ ...groupVersion, confirm: z.literal("CERRAR") });

export const playerPolicySchema = z.strictObject({
  referenceYear: z.number().int().min(2000).max(2200),
  minimumAge: z.number().int().min(0).max(120),
  maximumAge: z.number().int().min(0).max(120).nullable(),
  exceptionMinimumAge: z.number().int().min(0).max(120).nullable(),
  documents: z.array(z.enum(["PHOTO", "CURP", "CREDENTIAL", "SCHOOL_CREDENTIAL", "INE"])).min(1)
    .refine(items => new Set(items).size === items.length),
  registrationDays: z.array(z.number().int().min(1).max(7)).min(1)
    .refine(items => new Set(items).size === items.length),
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("es", { timeZone: value }); return true; } catch { return false; } }),
  playersOnField: z.number().int().min(1).max(30),
  maximumCalledUp: z.number().int().min(1).max(200).nullable(),
  maximumRoster: z.number().int().min(1).max(10000).nullable(),
}).superRefine((data, ctx) => {
  if (data.maximumAge !== null && data.maximumAge < data.minimumAge) ctx.addIssue({ code: "custom", path: ["maximumAge"], message: "El máximo debe ser igual o mayor al mínimo." });
  if (data.exceptionMinimumAge !== null && data.exceptionMinimumAge >= data.minimumAge) ctx.addIssue({ code: "custom", path: ["exceptionMinimumAge"], message: "La excepción debe quedar por debajo del mínimo ordinario." });
  if (data.maximumCalledUp !== null && data.maximumCalledUp < data.playersOnField) ctx.addIssue({ code: "custom", path: ["maximumCalledUp"], message: "La convocatoria debe cubrir los jugadores en cancha." });
  if (data.maximumRoster !== null && data.maximumCalledUp !== null && data.maximumRoster < data.maximumCalledUp) ctx.addIssue({ code: "custom", path: ["maximumRoster"], message: "La plantilla debe cubrir la convocatoria." });
});
export const configurePlayerPolicySchema = z.strictObject({ ...groupVersion, policy: playerPolicySchema });
export const seasonCategoryEditSchema = associateCategorySchema.omit({ categoryId: true });
export const seasonEditSchema = z.strictObject({ ...groupVersion,
  name: z.string().trim().min(1).max(160), startDate: z.iso.date(), endDate: z.iso.date(),
}).refine(data => data.endDate >= data.startDate, { path: ["endDate"], message: "Fechas inválidas." });
export const groupCreateSchema = z.strictObject({ ...groupVersion, name: z.string().trim().min(1).max(120) });
export const groupRenameSchema = groupCreateSchema.extend({ groupId: z.uuid() });
export const groupDeleteSchema = z.strictObject({ ...groupVersion, groupId: z.uuid() });
export const generalTableSchema = z.strictObject({ ...groupVersion, format: z.enum(["GENERAL_TABLE", "GROUP_STAGE"]) });
export const distributionSchema = z.strictObject({ ...groupVersion, enrollmentId: z.uuid(), groupId: z.uuid() });
export const automaticDistributionSchema = z.strictObject(groupVersion);
