import "server-only";
import { getPrisma } from "@/server/db/prisma";
import { getPermissionGrants, AuthorizationError } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

export async function getRecorderWorkspace(after?: string) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(tx => getRecorderWorkspaceInTransaction(tx, actor.id, after));
}

export async function getRecorderWorkspaceInTransaction(tx: Prisma.TransactionClient, actorId: string, after?: string) {
    if (after && !z.uuid().safeParse(after).success) throw new AuthorizationError();
    const [record, schedule, cancel, roles] = await Promise.all([
      getPermissionGrants(tx, actorId, "match-reports", "UPDATE"), getPermissionGrants(tx, actorId, "scheduling", "UPDATE"),
      getPermissionGrants(tx, actorId, "scheduling", "APPROVE"), tx.roles.findMany({ where: { code: { in: ["DATA_ENTRY", "SCHEDULER", "EXECUTIVE_PRESIDENT", "SUPERADMIN"] } }, select: { id: true, code: true } })]);
    const valid = (grant: (typeof record)[number], codes: string[]) => !grant.clubId && (!grant.contextOnly || !!grant.leagueId) && roles.some(r => r.id === grant.roleId && codes.includes(r.code));
    const recorderGrants = record.filter(g => valid(g, ["DATA_ENTRY"]));
    const schedulerGrants = schedule.filter(g => valid(g, ["SCHEDULER"]));
    const cancelGrants = cancel.filter(g => valid(g, ["EXECUTIVE_PRESIDENT", "SUPERADMIN"]));
    const grants = [...recorderGrants, ...schedulerGrants, ...cancelGrants];
    if (!grants.length) throw new AuthorizationError();
    const unrestricted = grants.some(g => !g.leagueId);
    const leagues = grants.flatMap(g => g.leagueId ? [g.leagueId] : []);
    const matches = await tx.matches.findMany({ where: { deleted_at: null, matchdays: { seasons: { status: { not: "CLOSED" }, leagues: { is_active: true }, ...(unrestricted ? {} : { league_id: { in: leagues } }) } },
      ...(after ? { id: { gt: after } } : {}), match_statuses: { code: { in: ["DRAFT", "SCHEDULED", "CONFIRMED", "IN_PROGRESS", "SUSPENDED"] } } },
      select: { id: true, number: true, version: true, starts_at: true, match_statuses: { select: { code: true } }, matchdays: { select: { seasons: { select: { name: true, league_id: true } } } } },
      orderBy: { id: "asc" }, take: 51 });
    const pairs = await tx.match_status_transitions.findMany({ where: { role_id: { in: grants.map(g => g.roleId) } }, select: { role_id: true,
      match_statuses_match_status_transitions_from_status_idTomatch_statuses: { select: { code: true } },
      match_statuses_match_status_transitions_to_status_idTomatch_statuses: { select: { code: true } } } });
    const has = (list: typeof grants, league: string, from: string, to: string) => list.some(g => (!g.leagueId || g.leagueId === league) && pairs.some(p => p.role_id === g.roleId && p.match_statuses_match_status_transitions_from_status_idTomatch_statuses.code === from && p.match_statuses_match_status_transitions_to_status_idTomatch_statuses.code === to));
    return { nextAfter: matches.length > 50 ? matches[49].id : null, items: matches.slice(0, 50).map(m => ({ id: m.id, number: m.number, version: m.version,
      status: m.match_statuses.code, startsAt: m.starts_at?.toISOString() ?? null, season: m.matchdays.seasons.name,
      canRecordMatch: has(recorderGrants, m.matchdays.seasons.league_id, m.match_statuses.code, m.match_statuses.code === "CONFIRMED" ? "IN_PROGRESS" : "SUSPENDED"),
      canSchedule: has(schedulerGrants, m.matchdays.seasons.league_id, m.match_statuses.code, m.match_statuses.code === "DRAFT" ? "SCHEDULED" : "CONFIRMED"),
      canCancel: has(cancelGrants, m.matchdays.seasons.league_id, m.match_statuses.code, "CANCELED") })) };
}

export async function canAccessRecorderWorkspace() {
  try { await getRecorderWorkspace(); return true; } catch (error) { if (error instanceof AuthorizationError) return false; throw error; }
}
