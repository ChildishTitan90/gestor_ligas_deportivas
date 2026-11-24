import "server-only";
import { getPrisma } from "@/server/db/prisma";
import { getPermissionGrants, AuthorizationError } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export async function getRecorderWorkspace(after?: string, matchdayId?: string) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(tx => getRecorderWorkspaceInTransaction(tx, actor.id, after, matchdayId));
}

export async function getRecorderWorkspaceInTransaction(tx: Prisma.TransactionClient, actorId: string, after?: string, matchdayId?: string) {
    if (after && !z.uuid().safeParse(after).success) throw new AuthorizationError();
    if (matchdayId && !z.uuid().safeParse(matchdayId).success) throw new AuthorizationError();
    const [record, schedule, cancel, discipline, roles] = await Promise.all([
      getPermissionGrants(tx, actorId, "match-reports", "UPDATE"), getPermissionGrants(tx, actorId, "scheduling", "UPDATE"),
      getPermissionGrants(tx, actorId, "scheduling", "APPROVE"), getPermissionGrants(tx, actorId, "discipline", "APPROVE"), tx.roles.findMany({ where: { code: { in: ["DATA_ENTRY", "SCHEDULER", "EXECUTIVE_PRESIDENT", "SUPERADMIN", "DISCIPLINARY_BOARD"] } }, select: { id: true, code: true } })]);
    const valid = (grant: (typeof record)[number], codes: string[]) => !grant.clubId && (!grant.contextOnly || !!grant.leagueId) && roles.some(r => r.id === grant.roleId && codes.includes(r.code));
    const recorderGrants = record.filter(g => valid(g, ["DATA_ENTRY"]));
    const schedulerGrants = schedule.filter(g => valid(g, ["SCHEDULER"]));
    const cancelGrants = cancel.filter(g => valid(g, ["EXECUTIVE_PRESIDENT", "SUPERADMIN"]));
    const reviewGrants = discipline.filter(g => valid(g, ["DISCIPLINARY_BOARD"]));
    const grants = [...recorderGrants, ...schedulerGrants, ...cancelGrants, ...reviewGrants];
    if (!grants.length) throw new AuthorizationError();
    const unrestricted = grants.some(g => !g.leagueId);
    const leagues = grants.flatMap(g => g.leagueId ? [g.leagueId] : []);
    const statuses=["DRAFT", "SCHEDULED", "CONFIRMED", "IN_PROGRESS", "SUSPENDED", "NO_SHOW", "RESCHEDULED", "UNSCHEDULED", "UNDER_REVIEW"];
    const matchdays = await tx.matchdays.findMany({where:{seasons:{status:{not:"CLOSED"},leagues:{is_active:true},...(unrestricted?{}:{league_id:{in:leagues}})},
      matches:{some:{deleted_at:null,match_statuses:{code:{in:statuses}}}}},
      select:{id:true,number:true,season_id:true,seasons:{select:{name:true,league_id:true,leagues:{select:{name:true}}}}},
      orderBy:[{seasons:{name:"asc"}},{number:"asc"},{id:"asc"}]});
    if (matchdayId && !matchdays.some(day=>day.id===matchdayId)) throw new AuthorizationError();
    const matches = await tx.matches.findMany({ where: { deleted_at: null, matchdays: { seasons: { status: { not: "CLOSED" }, leagues: { is_active: true }, ...(unrestricted ? {} : { league_id: { in: leagues } }) } },
      ...(matchdayId ? { matchday_id:matchdayId } : {}), ...(after ? { id: { gt: after } } : {}), match_statuses: { code: { in: statuses } } },
      select: { id: true, number: true, version: true, starts_at: true, venue_id: true, schedule_proposal_id:true, schedule_proposals:{select:{status:true}}, match_statuses: { select: { code: true } },
        venues: { select: { name: true } }, match_results: { select: { id: true } },
        referee_assignments: { where: { status: "APPROVED" }, select: { id: true }, take: 1 },
        season_teams_matches_home_team_id_season_idToseason_teams: { select: { teams: { select: { name: true } } } },
        season_teams_matches_away_team_id_season_idToseason_teams: { select: { teams: { select: { name: true } } } },
        match_reports:{select:{draft_data:true}}, matchdays: { select: { number: true, seasons: { select: { name: true, league_id: true,leagues:{select:{timezone:true}} } } } } },
      orderBy: { id: "asc" }, take: 51 });
    const pairs = await tx.match_status_transitions.findMany({ where: { role_id: { in: grants.map(g => g.roleId) } }, select: { role_id: true,
      match_statuses_match_status_transitions_from_status_idTomatch_statuses: { select: { code: true } },
      match_statuses_match_status_transitions_to_status_idTomatch_statuses: { select: { code: true } } } });
    const has = (list: typeof grants, league: string, from: string, to: string) => list.some(g => (!g.leagueId || g.leagueId === league) && pairs.some(p => p.role_id === g.roleId && p.match_statuses_match_status_transitions_from_status_idTomatch_statuses.code === from && p.match_statuses_match_status_transitions_to_status_idTomatch_statuses.code === to));
    const leagueIds=[...new Set(matches.slice(0,50).filter(m=>schedulerGrants.some(g=>!g.leagueId||g.leagueId===m.matchdays.seasons.league_id)).map(m=>m.matchdays.seasons.league_id))];
    const venues=leagueIds.length?await tx.venues.findMany({where:{league_id:{in:leagueIds},is_active:true},select:{id:true,name:true,league_id:true},orderBy:{name:"asc"}}):[];
    const proposalIds=[...new Set(matches.slice(0,50).flatMap(m=>m.schedule_proposal_id?[m.schedule_proposal_id]:[]))];
    const versions=proposalIds.length?await tx.audit_logs.findMany({where:{table_name:"schedule_proposals",entity_id:{in:proposalIds},action:"SCHEDULE_VERSION"},select:{entity_id:true}}):[];
    const updatedProposals=new Set(versions.map(v=>v.entity_id));
    const visibleIds=matches.slice(0,50).map(match=>match.id);
    const assigned=visibleIds.length ? await tx.$queryRaw<{match_id:string}[]>`SELECT ra.match_id FROM sports_management.referee_assignments ra
      JOIN sports_management.referees r ON r.id=ra.referee_id JOIN sports_management.matches m ON m.id=ra.match_id
      JOIN sports_management.match_statuses s ON s.id=m.status_id
      WHERE ra.match_id IN (${Prisma.join(visibleIds.map(id=>Prisma.sql`${id}::uuid`))}) AND ra.assignment_role='MAIN' AND ra.status='APPROVED' AND r.is_active
      AND (s.code<>'RESCHEDULED' OR sports_management.referee_assignment_effective(ra.id))` : [];
    const assignedMatches=new Set(assigned.map(row=>row.match_id));
    return { matchdays:matchdays.map(day=>({id:day.id,number:day.number,seasonId:day.season_id,season:day.seasons.name,league:day.seasons.leagues.name,
      canConfirm:has(schedulerGrants,day.seasons.league_id,"SCHEDULED","CONFIRMED") || has(schedulerGrants,day.seasons.league_id,"RESCHEDULED","CONFIRMED")})), nextAfter: matches.length > 50 ? matches[49].id : null, items: matches.slice(0, 50).map(m => ({ id: m.id, number: m.number, version: m.version,
      status: m.match_statuses.code, startsAt: m.starts_at?.toISOString() ?? null, season: m.matchdays.seasons.name,
      proposalStatus:m.schedule_proposals?.status ?? null, hasReferee:assignedMatches.has(m.id),
      matchday: m.matchdays.number, homeTeam: m.season_teams_matches_home_team_id_season_idToseason_teams.teams.name,
      awayTeam: m.season_teams_matches_away_team_id_season_idToseason_teams.teams.name, venueName: m.venues?.name ?? null,
      schedulingNotice: schedulerGrants.some(g => !g.leagueId || g.leagueId === m.matchdays.seasons.league_id) && ["SCHEDULED", "CONFIRMED", "RESCHEDULED", "UNSCHEDULED", "NO_SHOW"].includes(m.match_statuses.code)
        ? m.match_results ? "Este partido tiene un resultado registrado. Su modificación requiere el proceso autorizado de la liga."
          : m.match_reports && m.match_statuses.code !== "NO_SHOW" ? "Este partido tiene una cédula. La liga debe revisar el caso antes de reprogramarlo o dejarlo pendiente."
          : m.match_statuses.code === "NO_SHOW" && (m.match_reports?.draft_data as {draft?:{noShow?:{absent?:string}}}|undefined)?.draft?.noShow?.absent !== "BOTH" ? "La reprogramación por incomparecencia está disponible cuando ambos equipos estuvieron ausentes."
          : m.referee_assignments.length ? "Para reprogramar o dejar pendiente este partido, pide a la comisión de arbitraje que revoque primero la designación aprobada."
          : null : null,
      timezone:m.matchdays.seasons.leagues.timezone, venueId:m.venue_id, proposalId:m.schedule_proposal_id,
      hasUpdatedPdf:!!m.schedule_proposal_id && updatedProposals.has(m.schedule_proposal_id),
      canReschedule: (m.match_statuses.code === "DRAFT" ? has(schedulerGrants,m.matchdays.seasons.league_id,"DRAFT","SCHEDULED") : m.match_statuses.code === "RESCHEDULED"
        ? schedulerGrants.some(g=>!g.leagueId||g.leagueId===m.matchdays.seasons.league_id)
        : has(schedulerGrants,m.matchdays.seasons.league_id,m.match_statuses.code,"RESCHEDULED")) &&
        (m.match_statuses.code === "NO_SHOW"
          ? (m.match_reports?.draft_data as {draft?:{noShow?:{absent?:string}}}|undefined)?.draft?.noShow?.absent==="BOTH"
          : ["DRAFT","SCHEDULED","CONFIRMED","RESCHEDULED","UNSCHEDULED"].includes(m.match_statuses.code) && !m.match_reports),
      venues:venues.filter(venue=>venue.league_id===m.matchdays.seasons.league_id).map(venue=>({value:venue.id,label:venue.name})),
      canRecordMatch: has(recorderGrants, m.matchdays.seasons.league_id, m.match_statuses.code, m.match_statuses.code === "CONFIRMED" ? "IN_PROGRESS" : "SUSPENDED"),
      canSchedule: has(schedulerGrants, m.matchdays.seasons.league_id, m.match_statuses.code, m.match_statuses.code === "DRAFT" ? "SCHEDULED" : m.match_statuses.code === "UNSCHEDULED" ? "RESCHEDULED" : "CONFIRMED") || has(schedulerGrants,m.matchdays.seasons.league_id,m.match_statuses.code,"UNSCHEDULED"),
      canReview: has(reviewGrants, m.matchdays.seasons.league_id, m.match_statuses.code, "UNDER_REVIEW"),
      canResolve: has(reviewGrants, m.matchdays.seasons.league_id, m.match_statuses.code, "CANCELED"),
      canCancel: has(cancelGrants, m.matchdays.seasons.league_id, m.match_statuses.code, "CANCELED") })) };
}

export async function canAccessRecorderWorkspace() {
  try { await getRecorderWorkspace(); return true; } catch (error) { if (error instanceof AuthorizationError) return false; throw error; }
}
