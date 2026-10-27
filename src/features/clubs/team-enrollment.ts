import { z } from "zod";

const uuid = z.uuid().transform((value) => value.toLowerCase());

// La selección es excluyente: reutilizar teams.id o crear un equipo del club.
export const teamEnrollmentSchema = z.strictObject({
  enrollmentKey: uuid,
  clubId: uuid,
  seasonId: uuid,
  categoryId: uuid,
  groupId: uuid,
  team: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("existing"), teamId: uuid }),
    z.strictObject({ mode: z.literal("new"), name: z.string().trim().min(1).max(200) }),
  ]),
});

export type TeamEnrollmentInput = z.infer<typeof teamEnrollmentSchema>;

export function canonicalTeamEnrollment(data: TeamEnrollmentInput) {
  return JSON.stringify({ clubId: data.clubId, seasonId: data.seasonId,
    categoryId: data.categoryId, groupId: data.groupId,
    team: data.team.mode === "existing"
      ? { mode: "existing", teamId: data.team.teamId }
      : { mode: "new", name: data.team.name } });
}

export const enrollmentOptionsSchema = z.strictObject({
  clubId: uuid.optional(), seasonId: uuid.optional(),
  clubAfter: uuid.optional(), seasonAfter: uuid.optional(), teamAfter: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).refine((data) => !data.seasonId || !!data.clubId);

export const enrollmentOperationQuerySchema = z.strictObject({ clubId: uuid, enrollmentKey: uuid });
export const enrollmentCancellationSchema = z.union([teamEnrollmentSchema, enrollmentOperationQuerySchema]);

export const teamEnrollmentResultSchema = z.object({
  id: uuid, teamId: uuid, clubId: uuid, seasonId: uuid, categoryId: uuid, groupId: uuid,
  status: z.enum(["REGISTERED", "ACTIVE", "WITHDRAWN"]), replayed: z.boolean(),
});

export const teamEnrollmentOperationSchema = z.discriminatedUnion("outcome", [
  z.object({ enrollmentKey: uuid, clubId: uuid, outcome: z.literal("CONFIRMED"), enrollment: teamEnrollmentResultSchema }),
  z.object({ enrollmentKey: uuid, clubId: uuid, outcome: z.literal("CANCELLED"), enrollment: z.null() }),
  z.object({ enrollmentKey: uuid, clubId: uuid, outcome: z.literal("UNRESOLVED"), enrollment: z.null() }),
]);

/** Una respuesta antigua/de otro club nunca habilita una acción de escritura. */
export function enrollmentCreationAllowed(options: unknown, selectedClubId: string) {
  const parsed = z.object({ capabilities: z.object({ clubId: uuid, canEnroll: z.literal(true), canCreateTeam: z.literal(true) }) }).safeParse(options);
  return parsed.success && parsed.data.capabilities.clubId === selectedClubId.toLowerCase();
}

export const enrollmentListSchema = z.strictObject({
  clubId: uuid, seasonId: uuid.optional(), after: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
