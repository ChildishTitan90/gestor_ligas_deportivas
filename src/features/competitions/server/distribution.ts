import "server-only";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { automaticDistributionSchema, distributionSchema } from "../schemas";
import { CompetitionError } from "./configuration";

export async function listPendingDistribution(seasonId: string, participationId: string, after?: string) {
  const actor = await requireOperationalUser();
  if (![seasonId,participationId,...(after ? [after] : [])].every(id => z.uuid().safeParse(id).success)) throw new CompetitionError("INVALID_CONFIGURATION");
  return getPrisma().$transaction(async tx => {
    await assertPermission(tx, actor.id, { module: "clubs", action: "READ", context: { seasonId } });
    if (!await tx.season_categories.findFirst({ where: { id: participationId, season_id: seasonId, competition_format: "GROUP_STAGE" }, select: { id: true } }))
      throw new CompetitionError("INVALID_CONTEXT");
    const rows = await tx.season_teams.findMany({ where: { season_id: seasonId, season_category_id: participationId, group_id: null,
      status: "REGISTERED", teams: { status: "ACTIVE", clubs: { status: "ACTIVE" } }, ...(after ? { id: { gt: after } } : {}) }, take: 101, orderBy: { id: "asc" },
      select: { id: true, club_id: true, teams: { select: { name: true } }, club_affiliations: { select: { clubs: { select: { name: true } } } } } });
    return { items: rows.slice(0,100).map(row => ({ enrollmentId: row.id, clubId: row.club_id, teamName: row.teams.name,
      clubName: row.club_affiliations.clubs.name })), nextAfter: rows.length > 100 ? rows[99].id : null };
  });
}

/** Reparto equilibrado por carga actual; no sortea ni modifica asignaciones anteriores. */
export async function distributeCompetitionGroups(seasonId: string, participationId: string, input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = automaticDistributionSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(seasonId).success || !z.uuid().safeParse(participationId).success)
    throw new CompetitionError("INVALID_CONFIGURATION");
  const data = parsed.data;
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
    await assertPermission(tx, actor.id, { module: "clubs", action: "APPROVE", context: { seasonId } });
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId } });
    if (season.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
    if (season.competition_starts_at) throw new CompetitionError("COMPETITION_ALREADY_STARTED", 409);
    if (season.version !== data.expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
    const category = await tx.season_categories.findFirst({ where: { id: participationId, season_id: seasonId, competition_format: "GROUP_STAGE" } });
    if (!category) throw new CompetitionError("INVALID_CONTEXT");
    const groups = await tx.groups.findMany({ where: { season_id: seasonId, season_category_id: participationId },
      orderBy: { id: "asc" }, select: { id: true, _count: { select: { season_teams: true } } } });
    if (!groups.length) throw new CompetitionError("DISTRIBUTION_REQUIRES_GROUPS", 409);
    const pending = await tx.season_teams.findMany({ where: { season_id: seasonId, season_category_id: participationId,
      group_id: null, status: "REGISTERED", teams: { status: "ACTIVE", clubs: { status: "ACTIVE" } } }, orderBy: { id: "asc" }, take: 501, select: { id: true, club_id: true } });
    // Límite operativo explícito: nunca repartir una página como si fuera el total.
    if (pending.length > 500) throw new CompetitionError("DISTRIBUTION_TOO_LARGE", 409);
    if (!pending.length) return { assignments: [], seasonVersion: season.version };
    for (const clubId of new Set(pending.map(row => row.club_id))) {
      await assertPermission(tx, actor.id, { module: "clubs", action: "APPROVE", context: { seasonId, clubId } });
      const authorized = await tx.$queryRaw<{ category_id: string }[]>`
        SELECT ca.category_id FROM sports_management.club_affiliation_categories ca
        JOIN sports_management.club_affiliations a ON a.id=ca.affiliation_id AND a.season_id=ca.season_id
        WHERE a.club_id=${clubId}::uuid AND ca.season_id=${seasonId}::uuid AND ca.category_id=${category.category_id}::uuid
          AND a.status='APPROVED' AND ca.authorized_by IS NOT NULL AND ca.authorized_at IS NOT NULL FOR SHARE OF ca,a`;
      if (!authorized.length) throw new CompetitionError("CATEGORY_NOT_AUTHORIZED", 409);
    }
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${data.reason}, true)`;
    const loads = groups.map(group => ({ id: group.id, count: group._count.season_teams }));
    const assignments: { enrollmentId: string; groupId: string }[] = [];
    for (const row of pending) {
      const target = loads.reduce((best, group) => group.count < best.count ? group : best);
      await tx.season_teams.update({ where: { id: row.id }, data: { group_id: target.id } });
      target.count++;
      assignments.push({ enrollmentId: row.id, groupId: target.id });
    }
    const updated = await tx.seasons.update({ where: { id: seasonId }, data: { version: { increment: 1 } }, select: { version: true } });
    return { assignments, seasonVersion: updated.version };
  }, { timeout: 30_000 });
}

export async function assignCompetitionGroup(seasonId: string, participationId: string, input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = distributionSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(seasonId).success || !z.uuid().safeParse(participationId).success)
    throw new CompetitionError("INVALID_CONFIGURATION");
  const data = parsed.data;
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
    // Secretaría tiene APPROVE de clubes, no UPDATE de competitions en RF22.
    // Cada asignación exige esa autoridad vigente en el contexto completo.
    await tx.$queryRaw`SELECT id FROM sports_management.season_teams WHERE id=${data.enrollmentId}::uuid FOR UPDATE`;
    const enrollment = await tx.season_teams.findFirst({ where: { id: data.enrollmentId, season_id: seasonId, season_category_id: participationId } });
    if (!enrollment) throw new CompetitionError("INVALID_CONTEXT");
    await assertPermission(tx, actor.id, { module: "clubs", action: "APPROVE", context: { seasonId, clubId: enrollment.club_id } });
    if (!await tx.teams.findFirst({ where: { id: enrollment.team_id, status: "ACTIVE" }, select: { id: true } }))
      throw new CompetitionError("INVALID_CONTEXT");
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId } });
    if (season.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
    if (season.competition_starts_at) throw new CompetitionError("COMPETITION_ALREADY_STARTED", 409);
    if (season.version !== data.expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
    const category = await tx.season_categories.findFirst({ where: { id: participationId, season_id: seasonId, competition_format: "GROUP_STAGE" } });
    const group = await tx.groups.findFirst({ where: { id: data.groupId, season_id: seasonId, season_category_id: participationId } });
    if (!category || !group) throw new CompetitionError("INVALID_CONTEXT");
    const authorized = await tx.$queryRaw<{ category_id: string }[]>`
      SELECT ca.category_id FROM sports_management.club_affiliation_categories ca
      JOIN sports_management.club_affiliations a ON a.id=ca.affiliation_id AND a.season_id=ca.season_id
      WHERE a.club_id=${enrollment.club_id}::uuid
        AND ca.season_id=${seasonId}::uuid AND ca.category_id=${category.category_id}::uuid
        AND a.status='APPROVED' AND ca.authorized_by IS NOT NULL AND ca.authorized_at IS NOT NULL
      FOR SHARE OF ca,a`;
    if (!authorized.length)
      throw new CompetitionError("CATEGORY_NOT_AUTHORIZED", 409);
    if (enrollment.group_id || enrollment.status !== "REGISTERED") throw new CompetitionError("ENROLLMENT_ALREADY_DISTRIBUTED", 409);
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${data.reason}, true)`;
    await tx.season_teams.update({ where: { id: enrollment.id }, data: { group_id: group.id } });
    const updated = await tx.seasons.update({ where: { id: seasonId }, data: { version: { increment: 1 } }, select: { version: true } });
    // record_enrollment_audit y audit_season registran una vez cada cambio.
    return { enrollmentId: enrollment.id, groupId: group.id, seasonVersion: updated.version };
  });
}
