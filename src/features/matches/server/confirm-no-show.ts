import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { assertOwnRefereeAssignment } from "@/server/auth/authorization-domain";
import { reportAccess } from "@/features/match-reports/server/access";
import { draftSchema } from "@/features/match-reports/contract";
import { proposedNoShowScore } from "@/features/match-reports/no-show";
import type { ConfirmationEffects } from "@/features/match-reports/server/confirmation-effects";
import { MatchTransitionError } from "../transition-rules";

const schema=z.strictObject({matchId:z.uuid(),reportId:z.uuid(),operationId:z.uuid(),
  expectedMatchVersion:z.number().int().positive(),expectedReportVersion:z.number().int().positive()});

/** Receptor interno. El llamador debe aportar efectos reales y compartir la
 * transacción; no habilitar la entrada pública sin clasificación integrada. */
export async function confirmNoShowInTransaction(tx:Prisma.TransactionClient,actorId:string,raw:unknown,effects:Pick<ConfirmationEffects,"updateStandings"|"openIncidentCases">) {
  const parsed=schema.safeParse(raw);
  if(!parsed.success) throw new MatchTransitionError("INVALID_CONFIRMATION",400);
  const input=parsed.data, hash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
  await lockAuthorization(tx);
  const season=await tx.$queryRaw<{id:string;status:string}[]>`SELECT s.id,s.status FROM sports_management.seasons s
    JOIN sports_management.matches m ON m.season_id=s.id WHERE m.id=${input.matchId}::uuid FOR SHARE OF s`;
  if(!season[0]) throw new AuthorizationError();
  const match=await reportAccess(tx,actorId,input.matchId,"UPDATE");
  const grants=await assertPermission(tx,actorId,{module:"match-reports",action:"UPDATE",context:{matchId:match.id}});
  const referee=await tx.roles.findMany({where:{id:{in:grants.map(grant=>grant.roleId)},code:"REFEREE"},select:{id:true}});
  if(!referee.length) throw new AuthorizationError();
  await assertOwnRefereeAssignment(tx,actorId,match.id);
  const old=await tx.match_report_syncs.findUnique({where:{client_id:input.operationId},select:{user_id:true,private_payload:true}});
  if(old) {
    const payload=old.private_payload as {hash?:string;receipt?:{matchId:string;reportId:string;matchVersion:number;reportVersion:number}};
    if(old.user_id!==actorId||payload.hash!==hash||payload.receipt?.matchId!==input.matchId||payload.receipt.reportId!==input.reportId)
      throw new MatchTransitionError("IDEMPOTENCY_CONFLICT");
    return {...payload.receipt,replayed:true};
  }
  if(season[0].status==="CLOSED") throw new MatchTransitionError("SEASON_CLOSED");
  if(match.match_statuses.code!=="NO_SHOW") throw new MatchTransitionError("NO_SHOW_STATE_INVALID");
  if(match.version!==input.expectedMatchVersion) throw new MatchTransitionError("STALE_MATCH");
  const report=await tx.match_reports.findUnique({where:{id:input.reportId},select:{id:true,match_id:true,status:true,version:true,draft_data:true}});
  if(!report||report.match_id!==match.id||report.status!=="DRAFT"||report.version!==input.expectedReportVersion) throw new MatchTransitionError("STALE_REPORT");
  const stored=report.draft_data as {draft?:unknown;presentation?:Record<string,unknown>};
  const draft=draftSchema.safeParse(stored.draft);
  if(!draft.success||!draft.data.noShow||draft.data.noShow.absent==="BOTH") throw new MatchTransitionError("SINGLE_NO_SHOW_REQUIRED");
  const score=proposedNoShowScore(draft.data.noShow)!;
  const finished=await tx.match_statuses.findUniqueOrThrow({where:{code:"FINISHED"},select:{id:true}});
  const permitted=await tx.match_status_transitions.findFirst({where:{from_status_id:match.status_id,to_status_id:finished.id,role_id:{in:referee.map(role=>role.id)}},select:{id:true}});
  if(!permitted) throw new AuthorizationError();
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason','Confirmación de incomparecencia por árbitro',true),set_config('app.correlation_id',${input.operationId},true)`;
  await tx.match_results.create({data:{match_id:match.id,home_score:score.home,away_score:score.away,source:"DEFAULT",
    offending_team_id:draft.data.noShow.absent==="HOME"?match.home_team_id:match.away_team_id,validated_by:actorId,reason:"Incomparecencia confirmada por árbitro"}});
  const updated=await tx.matches.updateMany({where:{id:match.id,version:match.version,status_id:match.status_id,deleted_at:null},data:{status_id:finished.id,version:{increment:1}}});
  if(updated.count!==1) throw new MatchTransitionError("STALE_MATCH");
  await tx.match_status_history.create({data:{id:input.operationId,match_id:match.id,previous_status_id:match.status_id,new_status_id:finished.id,
    user_id:actorId,reason:"Confirmación de incomparecencia por árbitro",expected_version:input.expectedMatchVersion}});
  await effects.updateStandings(tx,{actorId,matchId:match.id,reportId:report.id,operationId:input.operationId,
    expectedMatchVersion:input.expectedMatchVersion,homeScore:score.home,awayScore:score.away,eventIds:[],dismissals:[]});
  await effects.openIncidentCases(tx,{actorId,matchId:match.id,reportId:report.id,operationId:input.operationId,
    expectedMatchVersion:input.expectedMatchVersion,homeScore:score.home,awayScore:score.away,eventIds:[],dismissals:[]});
  const confirmedAt=new Date();
  const presentation=stored.presentation ? {...stored.presentation,
    report:{...(stored.presentation.report as object),status:"CONFIRMED",version:report.version+1,confirmedAt:confirmedAt.toISOString()},
    match:{...(stored.presentation.match as object),version:match.version+1,status:{code:"FINISHED",label:"Finalizado",captureAllowed:false}}} : undefined;
  await tx.match_reports.update({where:{id:report.id},data:{status:"CONFIRMED",confirmed_at:confirmedAt,version:{increment:1},
    draft_data:{...stored,...(presentation?{presentation}:{})} as Prisma.InputJsonValue}});
  const receipt={matchId:match.id,reportId:report.id,matchVersion:match.version+1,reportVersion:report.version+1};
  await tx.match_report_syncs.create({data:{client_id:input.operationId,match_report_id:report.id,user_id:actorId,
    base_version:input.expectedReportVersion,status:"APPLIED",private_payload:{hash,receipt,command:{kind:"confirm-no-show",...input}}}});
  return {...receipt,replayed:false};
}
