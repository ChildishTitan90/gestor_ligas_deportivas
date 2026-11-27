import { z } from "zod";

export const auditEntities = {
  users: "Cuentas", clubs: "Clubes", teams: "Equipos", leagues: "Ligas",
  seasons: "Temporadas", club_affiliations: "Afiliaciones", player_registrations: "Jugadores",
  player_identity_corrections: "Correcciones de identidad", schedule_proposals: "Propuestas",
  matches: "Partidos", match_results: "Resultados", disciplinary_cases: "Expedientes",
  sanctions: "Sanciones", team_withdrawals: "Bajas", charges: "Cargos",
} as const;

const optionalText = <T extends z.ZodType>(schema: T) => z.preprocess(value => value === "" ? undefined : value, schema.optional());
export const auditFiltersSchema = z.strictObject({
  scope: optionalText(z.union([z.uuid(), z.literal("general")])),
  entity: optionalText(z.enum(Object.keys(auditEntities) as [keyof typeof auditEntities, ...Array<keyof typeof auditEntities>])),
  actor: optionalText(z.string().trim().regex(/^@?[a-zA-Z0-9._-]{1,60}$/).transform(value=>value.replace(/^@/, ""))),
  from: optionalText(z.iso.date()), to: optionalText(z.iso.date()),
  after: optionalText(z.string().max(1000)),
}).refine(input => !input.from || !input.to || input.from <= input.to);
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

export type AuditScope = { value: string; label: string; timezone: string };
export type AuditEntry = {
  id: string; at: string; actor: string; action: string; entity: string; name: string;
  scope: string; timezone: string; reason: string; reference: string;
};
export type AuditChange = { field: string; before: string; after: string };
export type AuditDetail = AuditEntry & { changes: AuditChange[] };
export type AuditWorkspace = {
  filters: AuditFilters; scopes: AuditScope[]; selected: AuditScope | null;
  entries: AuditEntry[]; next: string | null;
};

export function auditHref(filters: AuditFilters, after = filters.after) {
  const query = new URLSearchParams();
  for (const key of ["scope", "entity", "actor", "from", "to"] as const) {
    if (filters[key]) query.set(key, filters[key]);
  }
  if (after) query.set("after", after);
  return `/audit${query.size ? `?${query}` : ""}`;
}
