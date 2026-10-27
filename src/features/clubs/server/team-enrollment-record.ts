import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { canonicalTeamEnrollment, type TeamEnrollmentInput } from "../team-enrollment";

export const enrollmentSelect = {
  id: true, team_id: true, club_id: true, season_id: true, group_id: true, status: true,
  groups: { select: { season_categories: { select: { category_id: true } } } },
} satisfies Prisma.season_teamsSelect;

export function enrollmentResult(row: Prisma.season_teamsGetPayload<{ select: typeof enrollmentSelect }>, replayed: boolean) {
  return { id: row.id, teamId: row.team_id, clubId: row.club_id, seasonId: row.season_id,
    categoryId: row.groups.season_categories.category_id, groupId: row.group_id, status: row.status, replayed };
}

export function enrollmentFingerprint(input: TeamEnrollmentInput) {
  return createHash("sha256").update(canonicalTeamEnrollment(input)).digest("hex");
}

export async function lockEnrollmentOperation(tx: Prisma.TransactionClient, actorId: string, enrollmentKey: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-62:key:${actorId}:${enrollmentKey}`}, 0))::text`;
}

export function findEnrollmentOperation(tx: Prisma.TransactionClient, actorId: string, enrollmentKey: string) {
  return tx.team_enrollment_operations.findUnique({ where: { actor_id_enrollment_key: { actor_id: actorId, enrollment_key: enrollmentKey } },
    select: { club_id: true, fingerprint: true, outcome: true, season_teams: { select: enrollmentSelect } } });
}
