import "server-only";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { loadHomeVenueOptions } from "@/features/venues/server/scheduling-options";
import { venueLocalTime, venueTimeToIso } from "@/features/venues/time";
import { MatchTransitionError } from "../transition-rules";
import type { Prisma } from "@prisma/client";
import { assertPlayoffDate } from "./playoff-date";
import { playoffVenueAllowed } from "./playoff-venue";

const querySchema = z.object({ matchId: z.uuid(), venueId: z.uuid(), date: z.iso.date(), expectedVersion: z.number().int().positive() });
const calendarSchema = z.object({ complexOnlyFinalRounds: z.number().int().nonnegative().optional(), scheduling: z.object({ venueStages: z.array(z.object({ fromRound: z.number(), toRound: z.number(), venueIds: z.array(z.uuid()) })) }).optional() }).passthrough();

/** Lectura orientativa: el guardado vuelve a validar y reservar en su transacción. */
export async function getRescheduleSlots(raw: unknown) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(tx => getRescheduleSlotsInTransaction(tx,actor.id,raw),{timeout:60000});
}
export async function getRescheduleSlotsInTransaction(tx: Prisma.TransactionClient, actorId: string, raw: unknown) {
    const input = querySchema.parse(raw);
    const grants = (await assertPermission(tx, actorId, { module: "scheduling", action: "UPDATE", context: { matchId: input.matchId } })).filter(g => !g.clubId);
    const roles = await tx.roles.findMany({ where: { id: { in: grants.map(g => g.roleId) }, code: "SCHEDULER" }, select: { id: true } });
    if (!roles.length) throw new AuthorizationError();
    const match = await tx.matches.findUniqueOrThrow({ where: { id: input.matchId }, select: { id:true, version:true, deleted_at:true, season_id:true, group_id:true, matchday_id:true, home_team_id:true, away_team_id:true, starts_at:true, venue_id:true, match_statuses:{select:{code:true}}, matchdays:{select:{number:true}}, groups:{select:{season_categories:{select:{competition_rule_id:true}}}} } });
    if (match.deleted_at) throw new AuthorizationError();
    if (match.version !== input.expectedVersion) throw new MatchTransitionError("STALE_MATCH");
    const season = await tx.seasons.findUniqueOrThrow({ where:{id:match.season_id},select:{status:true,start_date:true,end_date:true,leagues:{select:{timezone:true}}} });
    if (season.status === "CLOSED") throw new MatchTransitionError("SEASON_CLOSED");
    const rule = await tx.competition_rules.findUniqueOrThrow({where:{id:match.groups.season_categories.competition_rule_id},select:{status:true,competition_rule_parameters:{where:{parameter_key:"calendar"},select:{parameter_value:true,requires_validation:true,validated_by:true}}}});
    const param=rule.competition_rule_parameters[0], policy=calendarSchema.safeParse(param?.parameter_value);
    if(rule.status!=="APPROVED" || !param || param.requires_validation || !param.validated_by || !policy.success) throw new MatchTransitionError("APPROVED_SCHEDULING_POLICY_REQUIRED");
    const stage=policy.data.scheduling?.venueStages.find(s=>match.matchdays.number>=s.fromRound && match.matchdays.number<=s.toRound);
    if(stage && !stage.venueIds.includes(input.venueId)) return [];
    const startDate=season.start_date.toISOString().slice(0,10), endDate=season.end_date.toISOString().slice(0,10);
    if(input.date<startDate || input.date>endDate) return [];
    await assertPlayoffDate(tx,match.id,input.date);
    const breaks=await tx.season_breaks.findMany({where:{season_id:match.season_id},select:{starts_at:true,ends_at:true}});
    const sanctions=await tx.sanctions.findMany({where:{season_team_id:{in:[match.home_team_id,match.away_team_id]},blocks_participation:true},select:{starts_at:true,ends_at:true}});
    const candidates: {value:string;label:string}[]=[];
    for(let minute=0;minute<1440;minute+=30) {
      const time=`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;
      const value=`${input.date}T${time}`, iso=venueTimeToIso(value,season.leagues.timezone);
      if(!iso) continue;
      const start=new Date(iso);
      if(match.match_statuses.code==="NO_SHOW" ? Boolean(match.starts_at && start<=match.starts_at) : start.getTime()<=Date.now()) continue;
      if(match.starts_at?.getTime()===start.getTime() && match.venue_id===input.venueId && !["NO_SHOW","DRAFT"].includes(match.match_statuses.code)) continue;
      const options=await loadHomeVenueOptions(tx,actorId,{seasonId:match.season_id,matchdayId:match.matchday_id,homeSeasonTeamId:match.home_team_id,awaySeasonTeamId:match.away_team_id,startsAt:start,complexOnlyFinalRounds:policy.data.complexOnlyFinalRounds??0});
      const option=options.find(o=>o.venueId===input.venueId); if(!option) continue;
      if(!await playoffVenueAllowed(tx,match.id,input.venueId,input.date,option.source)) continue;
      const last=venueLocalTime(new Date(option.reservedUntil.getTime()-1),season.leagues.timezone).slice(0,10);
      if(last>endDate || breaks.some(b=>input.date<=b.ends_at.toISOString().slice(0,10)&&last>=b.starts_at.toISOString().slice(0,10)) || sanctions.some(s=>s.starts_at<option.endsAt && (!s.ends_at || s.ends_at>start))) continue;
      if(last!==input.date) {
        try { await assertPlayoffDate(tx,match.id,last); }
        catch (error) { if(error instanceof MatchTransitionError && error.code==="PLAYOFF_ROUND_DATE") continue; throw error; }
      }
      const conflict=await tx.$queryRaw<{busy:boolean}[]>`SELECT EXISTS (SELECT 1 FROM sports_management.venue_reservations WHERE match_id <> ${match.id}::uuid AND venue_id=${input.venueId}::uuid AND time_range && tstzrange(${start},${option.reservedUntil},'[)')) OR EXISTS (SELECT 1 FROM sports_management.team_reservations WHERE match_id <> ${match.id}::uuid AND season_team_id IN (${match.home_team_id}::uuid,${match.away_team_id}::uuid) AND time_range && tstzrange(${start},${option.endsAt},'[)')) AS busy`;
      if(!conflict[0]?.busy) candidates.push({value,label:time});
    }
    return candidates;
}
