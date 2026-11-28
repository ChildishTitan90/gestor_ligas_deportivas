import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { eligibleResult, type ResultInput } from "@/features/standings/calculation";
import { projectStandingsForActorInTransaction } from "@/features/standings/server/service";
import { validateScheduleStructure } from "@/features/scheduling/structure-validation";
import { qualifyForPlayoffs } from "../playoff-qualification";

/** Read-only preview from current official results; must be recalculated under lock before committing a bracket. */
export async function previewPlayoffQualifiers(seasonId: string, categoryId: string) {
  const actor = await requireOperationalUser();
  return previewPlayoffQualifiersForActor(actor.id, seasonId, categoryId);
}

/** Internal use only: actorId is derived from a verified server session. */
export async function previewPlayoffQualifiersForActor(actorId: string, seasonId: string, categoryId: string) {
  if (!z.uuid().safeParse(seasonId).success || !z.uuid().safeParse(categoryId).success) throw Error("INVALID_CONTEXT");
  return getPrisma().$transaction(tx => previewPlayoffQualifiersInTransaction(tx, actorId, seasonId, categoryId), { isolationLevel: "RepeatableRead" });
}

/** The caller owns the transaction and must lock competition data before a write. */
export async function previewPlayoffQualifiersInTransaction(tx: Prisma.TransactionClient, actorId: string, seasonId: string, categoryId: string) {
    await lockAuthorization(tx);
    await assertPermission(tx, actorId, { module: "competitions", action: "READ", context: { seasonId } });
    const category = await tx.season_categories.findFirst({ where: { id: categoryId, season_id: seasonId }, include: { competition_rules: { include: { competition_rule_parameters: true } }, groups: { orderBy: { name: "asc" } } } });
    if (!category) throw Error("INVALID_CONTEXT");
    const rule = category.competition_rules;
    const parameter = rule.competition_rule_parameters.find(p => p.parameter_key === "calendar");
    const calendar = z.object({ rounds: z.number().int().min(1).max(4), playoff: z.object({ regularDeadline: z.iso.date() }) }).safeParse(parameter?.parameter_value);
    if (rule.status !== "APPROVED" || !parameter || parameter.requires_validation || !parameter.validated_by || !calendar.success) throw Error("PLAYOFF_RULE_REQUIRED");
    const groups = [];
    const fingerprints: string[] = [];
    const standingVersions: {groupId:string;matchdayId:string;id:string|null;version:number|null;validated:boolean}[] = [];
    for (const group of category.groups) {
      const teams = await tx.season_teams.findMany({ where: { group_id: group.id, status: { in: ["REGISTERED", "ACTIVE"] } }, select: { id: true } });
      if (teams.length < 2) throw Error("INCOMPLETE_GROUP");
      const matches = await tx.$queryRaw<(ResultInput & { round: number; matchdayId: string; confirmedAt: Date | null })[]>`
        SELECT m.id AS "matchId", m.home_team_id AS home, m.away_team_id AS away, m.matchday_id AS "matchdayId", d.number AS round,
          r.id, r.version, r.home_score AS "homeScore", r.away_score AS "awayScore", r.source, ms.code AS status,
          r.counts_in_standings AS counts, r.offending_team_id AS offender, mr.status AS "reportStatus", mr.confirmed_at AS "confirmedAt"
        FROM sports_management.matches m JOIN sports_management.matchdays d ON d.id=m.matchday_id AND d.season_id=m.season_id
        JOIN sports_management.match_statuses ms ON ms.id=m.status_id LEFT JOIN sports_management.match_results r ON r.match_id=m.id
        LEFT JOIN sports_management.match_reports mr ON mr.match_id=m.id
        WHERE m.group_id=${group.id}::uuid AND m.season_id=${seasonId}::uuid AND m.stage_id IS NULL AND m.deleted_at IS NULL ORDER BY d.number,m.id`;
      const expected = (teams.length % 2 ? teams.length : teams.length - 1) * calendar.data.rounds;
      const days = await tx.matchdays.findMany({ where: { season_id: seasonId, number: { lte: expected } }, orderBy: { number: "asc" }, select: { id: true, number: true, end_date: true } });
      if (days.length !== expected || days.some((day, i) => day.number !== i + 1 || day.end_date.toISOString().slice(0, 10) > calendar.data.playoff.regularDeadline) || !validateScheduleStructure(teams.map(t => t.id), days, calendar.data.rounds, matches).ok) throw Error("REGULAR_SCHEDULE_INCOMPLETE");
      if (matches.some(match => !match.id || !eligibleResult(match) || (match.source === "MATCH_REPORT" && !match.confirmedAt))) throw Error("OFFICIAL_RESULTS_INCOMPLETE");
      const standings = await projectStandingsForActorInTransaction(tx, actorId, { groupId: group.id, matchdayId: days[days.length - 1].id });
      const matchdayId=days[days.length - 1].id;
      const latest=await tx.standing_versions.findFirst({where:{group_id:group.id,matchday_id:matchdayId,competition_rule_id:rule.id},orderBy:{version_number:'desc'},select:{id:true,version_number:true,status:true,input_fingerprint:true,validated_by:true}});
      const validated=!!latest && latest.status==='VALIDATED' && !!latest.validated_by && latest.input_fingerprint===standings.fingerprint;
      standingVersions.push({groupId:group.id,matchdayId,id:validated?latest!.id:null,version:validated?latest!.version_number:null,validated});
      fingerprints.push(`${group.id}:${standings.fingerprint}`);
      if (standings.rows.length !== teams.length || standings.rows.some(row => !teams.some(team => team.id === row.teamId))) throw Error("STANDINGS_TEAM_SET_CHANGED");
      groups.push({ id: group.id, teams: standings.rows });
    }
    const result = qualifyForPlayoffs(groups);
    if (!result.ok) throw Error(result.code);
    const fingerprint = createHash("sha256").update(JSON.stringify({ seasonId, categoryId, ruleId: rule.id, fingerprints })).digest("hex");
    return { ...result, fingerprint, standingVersions, standingsValidated:standingVersions.every(item=>item.validated) };
}
