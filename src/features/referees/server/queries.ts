import "server-only";
import { readRefereeClubQuotas } from "./club-quota";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { assertCanProvisionRefereeAccess } from "@/features/accounts/server/referee-access";
import { readSeasonIdentityHistory } from "@/features/players/server/season-identity-history";
import { assessAssignment, authorizeRefereeing, personInRefereeingLeague, readRefereeingLeagues } from "./service";
import type { AssignmentAssessment, AssignmentStatus, HistoryPresentation, RefereePreviewData } from "../types";
export type LiveWorkspace = { data: RefereePreviewData; leagueId: string; seasonId: string; actorId: string; capabilities: { register: boolean; update: boolean; approve: boolean; provisionAccess: boolean }; assessments: Record<string, AssignmentAssessment> };
const empty = (): RefereePreviewData => ({ source: "DATABASE", leagues: [], seasons: [], clubs: [], people: [], referees: [], links: [], availability: [], matches: [], assignments: [], history: [] });
export async function getRefereeWorkspace(leagueId = "", seasonId = "") {
  return getRefereeWorkspaceForActor((await requireOperationalUser()).id, leagueId, seasonId);
}
export async function getRefereeWorkspaceForActor(actorId: string, leagueId = "", seasonId = ""): Promise<LiveWorkspace> {
  return getPrisma().$transaction(async tx => {
    const data = empty(); data.leagues = await readRefereeingLeagues(tx, actorId);
    const result: LiveWorkspace = { data, leagueId, seasonId, actorId, capabilities: { register: false, update: false, approve: false, provisionAccess: false }, assessments: {} };
    if (!data.leagues.length) throw new AuthorizationError();
    if (!leagueId) return result;
    if (!z.uuid().safeParse(leagueId).success || !data.leagues.some(l => l.id === leagueId)) throw new AuthorizationError();
    await authorizeRefereeing(tx, actorId, "READ", leagueId);
    const seasons = await tx.seasons.findMany({ where: { league_id: leagueId }, select: { id: true, name: true, status: true }, orderBy: { start_date: "desc" } });
    data.seasons = seasons.map(s => ({ id: s.id, name: s.name, leagueId, closed: s.status === "CLOSED" }));
    if (!seasonId) return result;
    const season = seasons.find(s => s.id === seasonId);
    if (!season) throw new AuthorizationError();
    await authorizeRefereeing(tx, actorId, "READ", leagueId, seasonId);
    for (const [key, action] of [["register", "CREATE"], ["update", "UPDATE"], ["approve", "APPROVE"]] as const) {
      try { await authorizeRefereeing(tx, actorId, action, leagueId, seasonId); result.capabilities[key] = season.status !== "CLOSED"; }
      catch (e) { if (!(e instanceof AuthorizationError)) throw e; }
    }
    data.clubs = await readRefereeClubQuotas(tx,seasonId);
    try { await assertCanProvisionRefereeAccess(tx, actorId, leagueId, seasonId); result.capabilities.provisionAccess = season.status !== "CLOSED"; }
    catch (e) { if (!(e instanceof AuthorizationError)) throw e; }
    const refs = await tx.referees.findMany({ where: { OR: [{ club_season_referees: { some: { season_id: seasonId } } }, { referee_assignments: { some: { matches: { season_id: seasonId } } } }] }, select: { id: true, person_id: true, is_active: true, version: true, people: { select: { first_name: true, paternal_surname: true, maternal_surname: true } } } });
    for (const r of refs) {
      let name = [r.people.first_name, r.people.paternal_surname, r.people.maternal_surname].filter(Boolean).join(" ");
      if (season.status === "CLOSED") { const identity = await readSeasonIdentityHistory(tx, r.person_id, seasonId); name = identity.status === "CAPTURED" ? [identity.firstName, identity.paternalSurname, identity.maternalSurname].filter(Boolean).join(" ") : "Identidad histórica no disponible"; }
      data.referees.push({ id: r.id, personId: r.person_id, name, active: r.is_active, version: r.version });
    }
    data.links = (await tx.club_season_referees.findMany({ where: { season_id: seasonId }, select: { referee_id: true, season_id: true, club_id: true } })).map(l => ({ refereeId: l.referee_id, seasonId: l.season_id, clubId: l.club_id }));
    if (season.status !== "CLOSED") {
      // Solo el catálogo de alta necesita identidades actuales; READ simple no
      // recibe un directorio de personas ajenas al padrón.
      if (result.capabilities.register || result.capabilities.update) {
        const people = await tx.people.findMany({ where: personInRefereeingLeague(leagueId), select: { id: true, first_name: true, paternal_surname: true, maternal_surname: true, referees:{select:{version:true}} }, orderBy: [{ first_name: "asc" }, { id: "asc" }] });
        data.people = people.map(p => ({ id: p.id, label: [p.first_name, p.paternal_surname, p.maternal_surname].filter(Boolean).join(" "), reference: p.id.slice(0,8),version:p.referees?.version??0 }));
      }
      const intervals = await tx.referee_availability.findMany({ where: { referee_id: { in: refs.map(r => r.id) } }, orderBy: { starts_at: "asc" } });
      data.availability = intervals.map(i => ({ id: i.id, refereeId: i.referee_id, startsAt: i.starts_at.toISOString(), endsAt: i.ends_at.toISOString(), available: i.is_available }));
    }
    const matches = await tx.$queryRaw<{id:string;number:string;version:number;category:string;group:string;group_id:string;home:string;away:string;venue:string;starts_at:Date|null;ends_at:Date|null;status:string}[]>`
      SELECT m.id,m.number,m.version,c.name AS category,g.name AS "group",g.id AS group_id,ht.name AS home,at.name AS away,v.name AS venue,m.starts_at,m.ends_at,ms.code AS status
      FROM sports_management.matches m JOIN sports_management.groups g ON g.id=m.group_id
      JOIN sports_management.season_categories sc ON sc.id=g.season_category_id JOIN sports_management.categories c ON c.id=sc.category_id
      JOIN sports_management.season_teams hs ON hs.id=m.home_team_id JOIN sports_management.teams ht ON ht.id=hs.team_id
      JOIN sports_management.season_teams ats ON ats.id=m.away_team_id JOIN sports_management.teams at ON at.id=ats.team_id
      JOIN sports_management.match_statuses ms ON ms.id=m.status_id LEFT JOIN sports_management.venues v ON v.id=m.venue_id
      WHERE m.season_id=${seasonId}::uuid ORDER BY m.starts_at,m.number`;
    const members = await tx.season_teams.findMany({ where: { season_id: seasonId }, select: { group_id: true, club_id: true, teams: { select: { name: true } } } });
    data.matches = matches.map(m => ({ id: m.id, number: m.number, seasonId, version: m.version, category: m.category, group: m.group, home: m.home, away: m.away, venue: m.venue ?? "Cancha sin asignar", startsAt: m.starts_at?.toISOString() ?? "", endsAt: m.ends_at?.toISOString() ?? "", groupClubs: members.filter(t => t.group_id === m.group_id).map(t => ({ clubId: t.club_id, team: t.teams.name })) }));
    const assignments = await tx.referee_assignments.findMany({ where: { matches: { season_id: seasonId } }, orderBy: { id: "asc" } });
    for (const a of assignments) {
      data.assignments.push({ id: a.id, matchId: a.match_id, refereeId: a.referee_id, status: a.status as AssignmentStatus, version: a.version });
      const evaluation = await assessAssignment(tx, a.match_id, a.referee_id, a.id);
      const r = refs.find(r => r.id === a.referee_id)!;
      const historical = season.status === "CLOSED" || matches.some(m => m.id === a.match_id && ["FINISHED","NO_SHOW","ADMINISTRATIVELY_RESOLVED"].includes(m.status));
      const terminal = matches.some(m=>m.id===a.match_id && ["FINISHED","NO_SHOW","ADMINISTRATIVELY_RESOLVED"].includes(m.status));
      const identity = historical ? await readRefereeIdentity(tx,r.person_id,seasonId,a.identity_snapshot,season.status==="CLOSED",terminal) : null;
      const presentation = data.assignments.at(-1)!;
      presentation.historical=historical;
      presentation.displayName=historical ? identity?.source==="UNAVAILABLE" ? "Identidad histórica no disponible" : identity?.label : data.referees.find(r=>r.id===a.referee_id)?.name;
      if(historical && identity?.source==="UNAVAILABLE")evaluation.blockers.push({code:"HISTORICAL_REFEREE_UNPROTECTED",message:"Falta evidencia histórica protegida. No se reconstruye la identidad con datos actuales."});
      if (!historical && a.status === "APPROVED") {
        const p = await tx.people.findUniqueOrThrow({ where: { id: r.person_id }, select: { identity_version: true } });
        if (a.approved_identity_version !== p.identity_version) evaluation.blockers.push({ code: "IDENTITY_CHANGED", message: "Cambió la identidad desde la aprobación; requiere nueva revisión." });
      }
      result.assessments[a.id] = evaluation;
      if (historical) data.history.push({ id: a.id, matchId: a.match_id, matchLabel: matches.find(m => m.id === a.match_id)?.number ?? "Partido retirado", refereeId: a.referee_id, seasonId, status: a.status as AssignmentStatus, occurredAt: a.approved_at?.toISOString() ?? "", identity: identity! });
    }
    // Historial de operaciones, actores y motivos: nunca nombres actuales como
    // identidad del pasado. Los nombres del padrón abierto son solo vigentes.
    const events = await tx.$queryRaw<{id:string;action:string;actor:string;reason:string;created_at:Date;referee_id:string;assignment_id:string|null;version:number}[]>`SELECT o.id,o.action,u.username AS actor,o.reason,o.created_at,o.referee_id,o.assignment_id,(o.result->>'version')::integer AS version FROM sports_management.referee_operations o JOIN sports_management.users u ON u.id=o.actor_id WHERE o.league_id=${leagueId}::uuid AND o.season_id=${seasonId}::uuid ORDER BY o.created_at DESC,o.id`;
    result.data.events = events.map(e => ({ id:e.id, refereeId:e.referee_id, assignmentId:e.assignment_id, action:e.action==="referee-account-access"?"Acceso arbitral habilitado":e.action, actor:e.actor, reason:e.reason, at:e.created_at.toISOString(),version:e.version }));
    return result;
  }, { timeout: 20000 });
}
export async function readRefereeIdentity(tx: Prisma.TransactionClient, personId: string, seasonId: string, matchSnapshot: Prisma.JsonValue, closedSeason: boolean, terminalMatch: boolean): Promise<HistoryPresentation["identity"]> {
  const parsed = z.object({ source:z.literal("MATCH_CLOSURE_V1"),label:z.string(),identityVersion:z.number().int().positive(),capturedAt:z.iso.datetime({offset:true}) }).safeParse(matchSnapshot);
  if(parsed.success)return parsed.data;
  if(terminalMatch)return {source:"UNAVAILABLE"};
  if (closedSeason) {
    const identity = await readSeasonIdentityHistory(tx, personId, seasonId);
    return identity.status === "CAPTURED" ? { source: "SEASON_CLOSURE_V1", label: [identity.firstName,identity.paternalSurname,identity.maternalSurname].filter(Boolean).join(" "), identityVersion: identity.identityVersion, capturedAt: identity.capturedAt } : { source: "UNAVAILABLE" };
  }
  return { source: "UNAVAILABLE" };
}
