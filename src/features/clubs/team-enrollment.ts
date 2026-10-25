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
}).refine((data) => !data.seasonId || !!data.clubId);

export const enrollmentListSchema = z.strictObject({
  clubId: uuid, seasonId: uuid.optional(), after: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
