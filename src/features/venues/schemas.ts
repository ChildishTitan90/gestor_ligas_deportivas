import { z } from "zod";

export const venueIdSchema = z.uuid();

const minutes = (min: number) => z.string().regex(/^\d+$/).transform(Number)
  .pipe(z.number().int().min(min).max(1440));

export const venueSchema = z.object({
  leagueId: venueIdSchema,
  venueId: z.union([venueIdSchema, z.literal("")]),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  address: z.string().trim().min(1).max(300),
  kind: z.enum(["complex", "private"]),
  features: z.string().trim().max(1000),
  duration: minutes(1),
  buffer: minutes(0),
});

export const intervalTypes = ["AVAILABLE", "BLOCK", "MAINTENANCE"] as const;
export const intervalLabels = { AVAILABLE: "Disponibilidad", BLOCK: "Bloqueo", MAINTENANCE: "Mantenimiento" };

export const intervalSchema = z.object({
  venueId: venueIdSchema,
  intervalId: z.union([venueIdSchema, z.literal("")]),
  type: z.enum(intervalTypes),
  start: z.iso.datetime({ offset: true }).transform(value => new Date(value)),
  end: z.iso.datetime({ offset: true }).transform(value => new Date(value)),
  reason: z.string().trim().max(300),
}).refine(data => data.end > data.start && (data.type === "AVAILABLE" || data.reason.length > 0));
