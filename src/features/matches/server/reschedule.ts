import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, getPermissionGrants, lockAuthorization } from "@/server/auth/authorization";
import { loadHomeVenueOptions } from "@/features/venues/server/scheduling-options";
import { venueLocalTime, venueTimeToIso } from "@/features/venues/time";
import { draftSchema } from "@/features/match-reports/contract";
import { rescheduleSchema } from "../schemas";
import { MatchTransitionError } from "../transition-rules";

const policySchema=z.object({complexOnlyFinalRounds:z.number().int().nonnegative().optional(),
  scheduling:z.object({venueStages:z.array(z.object({fromRound:z.number().int().positive(),toRound:z.number().int().positive(),venueIds:z.array(z.uuid()).min(1)}))}).optional()}).passthrough();

/** Reprograma el mismo partido cuando ambos equipos no se presentaron. */
export async function rescheduleAbsentMatchInTransaction(tx:Prisma.TransactionClient,actorId:string,raw:unknown) {
  const parsed=rescheduleSchema.safeParse(raw);
  if(!parsed.success) throw new MatchTransitionError("INVALID_RESCHEDULE",400);
  const input=parsed.data;
  const hash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
  await lockAuthorization(tx);
  await getPermissionGrants(tx,actorId,"scheduling","UPDATE");
  const seasons=await tx.$queryRaw<{id:string;status:string;league_id:string;start_date:Date;end_date:Date;timezone:string}[]>`
    SELECT s.id,s.status,s.league_id,s.start_date,s.end_date,l.timezone FROM sports_management.seasons s
    JOIN sports_management.matches m ON m.season_id=s.id JOIN sports_management.leagues l ON l.id=s.league_id
    WHERE m.id=${input.matchId}::uuid FOR SHARE OF s,l`;
  if(!seasons[0]) throw new AuthorizationError();
  const locked=await tx.$queryRaw<{id:string}[]>`SELECT id FROM sports_management.matches WHERE id=${input.matchId}::uuid FOR UPDATE`;
  if(!locked.length) throw new AuthorizationError();
  const match=await tx.matches.findUniqueOrThrow({where:{id:input.matchId},select:{id:true,season_id:true,group_id:true,matchday_id:true,
    home_team_id:true,away_team_id:true,venue_id:true,starts_at:true,ends_at:true,reserved_until:true,status_id:true,version:true,deleted_at:true,
    match_statuses:{select:{code:true}}}});
  const grants=(await assertPermission(tx,actorId,{module:"scheduling",action:"UPDATE",context:{matchId:match.id}})).filter(grant=>!grant.clubId);
  const roles=await tx.roles.findMany({where:{id:{in:grants.map(grant=>grant.roleId)},code:"SCHEDULER"},select:{id:true}});
  if(!roles.length || match.deleted_at) throw new AuthorizationError();
  const prior=await tx.audit_logs.findUnique({where:{id:input.operationId},select:{action:true,user_id:true,entity_id:true,new_data:true}});
  if(prior) {
    const saved=prior.new_data as {hash?:string;version?:number}|null;
    if(prior.action!=="MATCH_RESCHEDULED" || prior.user_id!==actorId || prior.entity_id!==match.id || saved?.hash!==hash)
      throw new MatchTransitionError("IDEMPOTENCY_CONFLICT");
    return {operationId:input.operationId,matchId:match.id,appliedVersion:saved.version!,replayed:true};
  }
  if(seasons[0].status==="CLOSED") throw new MatchTransitionError("SEASON_CLOSED");
  if(match.version!==input.expectedVersion) throw new MatchTransitionError("STALE_MATCH");
  if(match.match_statuses.code!=="NO_SHOW") throw new MatchTransitionError("RESCHEDULE_STATE_INVALID");
  const report=await tx.match_reports.findUnique({where:{match_id:match.id},select:{id:true,status:true,version:true,draft_data:true}});
  const draft=draftSchema.safeParse((report?.draft_data as {draft?:unknown}|undefined)?.draft);
  if(!report || report.status!=="DRAFT" || !draft.success || draft.data.noShow?.absent!=="BOTH") throw new MatchTransitionError("BOTH_ABSENT_REQUIRED");
  if(await tx.match_results.findUnique({where:{match_id:match.id},select:{id:true}})) throw new MatchTransitionError("MATCH_RESULT_EXISTS");
  // La designación cerrada conserva una fotografía histórica; no se reutiliza
  // para una nueva celebración. La comisión debe revocarla y designar de nuevo.
  if(await tx.referee_assignments.findFirst({where:{match_id:match.id,status:"APPROVED"},select:{id:true}}))
    throw new MatchTransitionError("REFEREE_REASSIGN_REQUIRED");
  const evidence=await tx.$queryRaw<{id:string}[]>`SELECT id FROM sports_management.match_report_syncs
    WHERE match_report_id=${report.id}::uuid AND status='APPLIED' AND private_payload #>> '{command,kind}'='record-no-show'
    ORDER BY received_at DESC,id DESC LIMIT 1`;
  if(!evidence.length) throw new MatchTransitionError("NO_SHOW_EVIDENCE_REQUIRED");
  const status=await tx.match_statuses.findUniqueOrThrow({where:{code:"RESCHEDULED"},select:{id:true}});
  const allowed=await tx.match_status_transitions.findFirst({where:{from_status_id:match.status_id,to_status_id:status.id,role_id:{in:roles.map(role=>role.id)}},select:{id:true}});
  if(!allowed) throw new AuthorizationError();
  const startsAt=venueTimeToIso(input.startsAtLocal,seasons[0].timezone);
  if(!startsAt) throw new MatchTransitionError("INVALID_LOCAL_TIME");
  const start=new Date(startsAt),date=input.startsAtLocal.slice(0,10);
  if(date<seasons[0].start_date.toISOString().slice(0,10)||date>seasons[0].end_date.toISOString().slice(0,10) || (match.starts_at && start<=match.starts_at))
    throw new MatchTransitionError("INVALID_RESCHEDULE_DATE");
  const category=await tx.groups.findUniqueOrThrow({where:{id:match.group_id},select:{season_categories:{select:{competition_rule_id:true}}}});
  const rule=await tx.competition_rules.findUniqueOrThrow({where:{id:category.season_categories.competition_rule_id},select:{status:true,competition_rule_parameters:{where:{parameter_key:"calendar"},select:{parameter_value:true,requires_validation:true,validated_by:true}}}});
  const param=rule.competition_rule_parameters[0],policy=policySchema.safeParse(param?.parameter_value);
  if(rule.status!=="APPROVED"||!param||param.requires_validation||!param.validated_by||!policy.success) throw new MatchTransitionError("APPROVED_SCHEDULING_POLICY_REQUIRED");
  const day=await tx.matchdays.findUniqueOrThrow({where:{id:match.matchday_id},select:{number:true}});
  const stage=policy.data.scheduling?.venueStages.find(value=>day.number>=value.fromRound&&day.number<=value.toRound);
  if(stage&&!stage.venueIds.includes(input.venueId)) throw new MatchTransitionError("VENUE_STAGE");
  const options=await loadHomeVenueOptions(tx,actorId,{seasonId:match.season_id,matchdayId:match.matchday_id,
    homeSeasonTeamId:match.home_team_id,awaySeasonTeamId:match.away_team_id,startsAt:start,complexOnlyFinalRounds:policy.data.complexOnlyFinalRounds??0});
  const option=options.find(value=>value.venueId===input.venueId);
  if(!option) throw new MatchTransitionError("VENUE_NOT_AVAILABLE");
  const finalDate=venueLocalTime(new Date(option.reservedUntil.getTime()-1),seasons[0].timezone).slice(0,10);
  if(finalDate>seasons[0].end_date.toISOString().slice(0,10)) throw new MatchTransitionError("INVALID_RESCHEDULE_DATE");
  const breaks=await tx.season_breaks.findMany({where:{season_id:match.season_id},select:{starts_at:true,ends_at:true}});
  if(breaks.some(value=>date<=value.ends_at.toISOString().slice(0,10)&&finalDate>=value.starts_at.toISOString().slice(0,10))) throw new MatchTransitionError("SEASON_BREAK");
  const sanction=await tx.sanctions.findFirst({where:{season_team_id:{in:[match.home_team_id,match.away_team_id]},blocks_participation:true,
    starts_at:{lt:option.endsAt},OR:[{ends_at:null},{ends_at:{gt:start}}]},select:{id:true}});
  if(sanction) throw new MatchTransitionError("TEAM_SUSPENDED");
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${input.reason},true),set_config('app.correlation_id',${input.operationId},true)`;
  await tx.audit_logs.create({data:{id:input.operationId,user_id:actorId,action:"MATCH_RESCHEDULED",table_name:"matches",entity_id:match.id,
    previous_data:{venueId:match.venue_id,startsAt:match.starts_at?.toISOString()??null,endsAt:match.ends_at?.toISOString()??null,
      reservedUntil:match.reserved_until?.toISOString()??null,reportId:report.id,reportVersion:report.version,noShowReceiptId:evidence[0].id},
    new_data:{hash,version:match.version+1,venueId:input.venueId,startsAt,endsAt:option.endsAt.toISOString(),reservedUntil:option.reservedUntil.toISOString()},reason:input.reason}});
  const changed=await tx.matches.updateMany({where:{id:match.id,version:input.expectedVersion,status_id:match.status_id,deleted_at:null},
    data:{status_id:status.id,venue_id:input.venueId,starts_at:start,ends_at:option.endsAt,reserved_until:option.reservedUntil,version:{increment:1}}});
  if(changed.count!==1) throw new MatchTransitionError("STALE_MATCH");
  await tx.match_status_history.create({data:{id:input.operationId,match_id:match.id,previous_status_id:match.status_id,new_status_id:status.id,
    user_id:actorId,reason:input.reason,expected_version:input.expectedVersion}});
  const emptyDraft={lineups:[],captains:{},events:[],score:{home:null,away:null},remarks:"",incidents:"",signatures:{}};
  await tx.match_reports.update({where:{id:report.id},data:{version:{increment:1},remarks:"",draft_data:{formatVersion:1,draft:emptyDraft}}});
  return {operationId:input.operationId,matchId:match.id,appliedVersion:input.expectedVersion+1,replayed:false};
}
