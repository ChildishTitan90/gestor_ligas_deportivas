import "server-only";
import { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { captureUpdatedSchedule } from "@/features/scheduling/server/updated-schedule-pdf";
import { storedProposalSchema } from "@/features/scheduling/stored-proposal";
import { transitionSchema } from "../schemas";
import { assertReplay, MatchTransitionError, receiptDto, type TransitionReceipt } from "../transition-rules";

/** La comisión solo puede cancelar sin resultados; nunca borra la cédula ni sus evidencias. */
export async function cancelReviewedMatchInTransaction(tx:Prisma.TransactionClient,actorId:string,raw:unknown) {
  const parsed=transitionSchema.safeParse(raw);
  if(!parsed.success || parsed.data.toStatus!=="CANCELED") throw new MatchTransitionError("INVALID_TRANSITION",400);
  const input=parsed.data;
  await lockAuthorization(tx);
  const season=await tx.$queryRaw<{id:string;status:string;proposal_id:string|null}[]>`SELECT s.id,s.status,m.schedule_proposal_id AS proposal_id
    FROM sports_management.seasons s JOIN sports_management.matches m ON m.season_id=s.id WHERE m.id=${input.matchId}::uuid FOR SHARE OF s`;
  if(!season[0])throw new AuthorizationError();
  if(season[0].proposal_id)await tx.$queryRaw`SELECT id FROM sports_management.schedule_proposals WHERE id=${season[0].proposal_id}::uuid FOR UPDATE`;
  const locked=await tx.$queryRaw<{id:string}[]>`SELECT id FROM sports_management.matches WHERE id=${input.matchId}::uuid FOR UPDATE`;
  if(!locked.length)throw new AuthorizationError();
  const match=await tx.matches.findUniqueOrThrow({where:{id:input.matchId},select:{id:true,version:true,status_id:true,deleted_at:true,match_statuses:{select:{code:true}}}});
  if(match.deleted_at)throw new AuthorizationError();
  const grants=(await assertPermission(tx,actorId,{module:"discipline",action:"APPROVE",context:{matchId:match.id}})).filter(g=>!g.clubId);
  const roles=await tx.roles.findMany({where:{id:{in:grants.map(g=>g.roleId)},code:"DISCIPLINARY_BOARD"},select:{id:true}});
  if(!roles.length)throw new AuthorizationError();
  const allowed=await tx.$queryRaw<{id:string}[]>`SELECT t.id FROM sports_management.match_status_transitions t
    JOIN sports_management.match_statuses f ON f.id=t.from_status_id JOIN sports_management.match_statuses n ON n.id=t.to_status_id
    WHERE f.code='UNDER_REVIEW' AND n.code='CANCELED' AND t.role_id IN (${Prisma.join(roles.map(r=>Prisma.sql`${r.id}::uuid`))})`;
  if(!allowed.length)throw new AuthorizationError();
  const receipts=await tx.$queryRaw<TransitionReceipt[]>`SELECT h.id,h.match_id AS "matchId",h.user_id AS "actorId",h.reason,
    h.expected_version AS "expectedVersion",h.created_at AS "createdAt",f.code AS "fromStatus",n.code AS "toStatus"
    FROM sports_management.match_status_history h JOIN sports_management.match_statuses f ON f.id=h.previous_status_id
    JOIN sports_management.match_statuses n ON n.id=h.new_status_id WHERE h.id=${input.operationId}::uuid`;
  if(receipts[0]) {assertReplay(receipts[0],actorId,input);if(receipts[0].fromStatus!=="UNDER_REVIEW")throw new AuthorizationError();return receiptDto(receipts[0],true);}
  if(season[0].status==="CLOSED")throw new MatchTransitionError("SEASON_CLOSED");
  if(match.version!==input.expectedVersion)throw new MatchTransitionError("STALE_MATCH");
  if(match.match_statuses.code!=="UNDER_REVIEW")throw new MatchTransitionError("TRANSITION_NOT_IMPLEMENTED");
  if(await tx.match_results.findUnique({where:{match_id:match.id},select:{id:true}}))throw new MatchTransitionError("MATCH_RESULT_EXISTS");
  const canceled=await tx.match_statuses.findUniqueOrThrow({where:{code:"CANCELED"},select:{id:true}});
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${input.reason},true),set_config('app.correlation_id',${input.operationId},true)`;
  await tx.matches.update({where:{id:match.id},data:{status_id:canceled.id,version:{increment:1}}});
  const history=await tx.match_status_history.create({data:{id:input.operationId,match_id:match.id,previous_status_id:match.status_id,new_status_id:canceled.id,
    user_id:actorId,reason:input.reason,expected_version:input.expectedVersion},select:{created_at:true}});
  if(season[0].proposal_id) {
    const proposal=await tx.schedule_proposals.findUnique({where:{id:season[0].proposal_id},select:{status:true,parameters:true}});
    if(proposal?.status==="APPROVED" && storedProposalSchema.safeParse(proposal.parameters).success)
      await captureUpdatedSchedule(tx,season[0].proposal_id,actorId,input.reason);
  }
  return receiptDto({id:input.operationId,matchId:match.id,actorId,fromStatus:"UNDER_REVIEW",toStatus:"CANCELED",
    expectedVersion:input.expectedVersion,reason:input.reason,createdAt:history.created_at},false);
}
