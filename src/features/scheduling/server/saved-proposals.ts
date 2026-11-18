import "server-only";
import { z } from "zod";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { getPrisma } from "@/server/db/prisma";

const proposalSchema = z.object({
  formatVersion: z.literal(1),
  groupId: z.uuid(),
  categoryId: z.uuid(),
  timezone: z.string().optional(),
  teamNames: z.record(z.string(), z.string()).optional(),
  venueNames: z.record(z.string(), z.string()).optional(),
  preferenceOptimal: z.boolean().optional(),
  matches: z.array(z.object({
    round: z.number().int().positive(), home: z.string(), away: z.string(),
    venueId: z.string(), start: z.iso.datetime(), end: z.iso.datetime(),
  })),
  byes: z.array(z.object({ round: z.number().int().positive(), teamId: z.string() })),
});

export async function listSavedScheduleProposals(actorId: string, seasonId: string, groupId: string) {
  const ids = z.object({ seasonId: z.uuid(), groupId: z.uuid() }).parse({ seasonId, groupId });
  return getPrisma().$transaction(async tx => {
    const grants = await assertPermission(tx, actorId, {
      module: "scheduling", action: "CREATE", context: { seasonId: ids.seasonId },
    });
    if (!grants.some(grant => !grant.clubId)) throw new AuthorizationError();
    const group = await tx.groups.findFirst({
      where: { id: ids.groupId, season_id: ids.seasonId },
      select: { id: true, season_category_id: true },
    });
    if (!group) throw new AuthorizationError();
    const rows = await tx.schedule_proposals.findMany({
      where: { season_id: ids.seasonId },
      select: { id: true, created_at: true, parameters: true },
      orderBy: [{ created_at: "desc" }, { id: "asc" }],
    });
    return rows.flatMap(row => {
      const proposal = proposalSchema.safeParse(row.parameters);
      if (!proposal.success || proposal.data.groupId !== group.id ||
          proposal.data.categoryId !== group.season_category_id) return [];
      return [{ id: row.id, createdAt: row.created_at.toISOString(), proposal: proposal.data }];
    });
  });
}
