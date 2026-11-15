import { z } from "zod";

export const consequences = {
  MATCHES: "Suspensión por partidos", MATCHDAYS: "Suspensión por jornadas", TIME: "Suspensión por tiempo",
  FINE: "Multa", MATCH_FORFEIT: "Pérdida de partido", POINTS_DEDUCTION: "Descuento de puntos", TEAM_WITHDRAWAL: "Baja de equipo",
} as const;
const positive = z.number().int().min(1).max(100000);
export const consequenceSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("MATCHES"), quantity: positive }),
  z.strictObject({ type: z.literal("MATCHDAYS"), quantity: positive }),
  z.strictObject({ type: z.literal("TIME"), quantity: positive, unit: z.enum(["DAYS", "MONTHS", "YEARS"]) }),
  z.strictObject({ type: z.literal("FINE"), amount: z.string().regex(/^(?:0|[1-9]\d{0,7})\.\d{2}$/).refine(v => Number(v) > 0), currency: z.literal("MXN") }),
  z.strictObject({ type: z.literal("MATCH_FORFEIT") }),
  z.strictObject({ type: z.literal("POINTS_DEDUCTION"), quantity: positive }),
  z.strictObject({ type: z.literal("TEAM_WITHDRAWAL") }),
]);
export const articleSchema = z.strictObject({
  number: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(4000),
  configuration: z.strictObject({
    schemaVersion: z.literal(1), target: z.enum(["PLAYER", "TEAM"]), consequence: consequenceSchema,
    source: z.strictObject({ origin: z.enum(["SYNTHETIC", "DOCUMENTED"]), document: z.string().trim().min(1).max(500),
      season: z.string().trim().min(1).max(100), reference: z.string().trim().min(1).max(200), confirmed: z.boolean() }),
  }),
}).superRefine((v, ctx) => {
  const c = v.configuration;
  if (c.source.origin === "SYNTHETIC" && (c.source.confirmed || !v.number.startsWith("DEMO-")))
    ctx.addIssue({ code: "custom", message: "Los ejemplos usan DEMO- y no se validan como oficiales." });
  if (["MATCH_FORFEIT", "POINTS_DEDUCTION", "TEAM_WITHDRAWAL"].includes(c.consequence.type) && c.target !== "TEAM")
    ctx.addIssue({ code: "custom", message: "Esta consecuencia corresponde a un equipo." });
});
const common = { operationId: z.uuid(), ruleId: z.uuid(), reason: z.string().trim().min(1).max(1000) };
export const catalogMutation = z.discriminatedUnion("operation", [
  z.strictObject({ ...common, operation: z.literal("create"), article: articleSchema }),
  z.strictObject({ ...common, operation: z.literal("edit"), articleId: z.uuid(), expectedRevision: positive, article: articleSchema }),
  z.strictObject({ ...common, operation: z.literal("clone") }),
]);
export type CatalogMutation = z.infer<typeof catalogMutation>;
export type ArticleInput = z.infer<typeof articleSchema>;
export function consequenceLabel(c: ArticleInput["configuration"]["consequence"]) {
  if (c.type === "FINE") return `${c.amount} ${c.currency}`;
  if ("quantity" in c) {
    const units = c.type === "TIME"
      ? { DAYS: ["día", "días"], MONTHS: ["mes", "meses"], YEARS: ["año", "años"] }[c.unit]
      : { MATCHES: ["partido", "partidos"], MATCHDAYS: ["jornada", "jornadas"], POINTS_DEDUCTION: ["punto", "puntos"] }[c.type];
    return `${c.quantity} ${units[c.quantity === 1 ? 0 : 1]}`;
  }
  return consequences[c.type];
}
