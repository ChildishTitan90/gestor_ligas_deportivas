import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { storedProposalSchema } from "../stored-proposal";
import { pendingEncounter } from "../pending-encounters";
import { proposeTeamSwap } from "../team-swap";
import { SchedulingError, validateScheduleProposalInTransaction } from "./service";

const inputSchema = z.strictObject({ proposalId:z.uuid(), expectedVersion:z.number().int().positive(), swaps:z.array(z.strictObject({round:z.number().int().positive(),
  first:z.uuid(), second:z.uuid()})).min(1).max(50), reason:z.string().trim().min(8).max(500) });

export async function saveTeamSwap(input: unknown) {
  const actor=await requireOperationalUser();
  return saveTeamSwapForActor(actor.id,input);
}

export async function saveTeamSwapForActor(actorId:string,input:unknown) {
  try {
    return await getPrisma().$transaction(tx=>saveTeamSwapInTransaction(tx,actorId,input),
      {isolationLevel:"Serializable",maxWait:10000,timeout:30000});
  } catch(error) {
    if(error instanceof SchedulingError) return {code:error.code};
    if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==="P2034") return {code:"ADJUSTMENT_CONFLICT"};
    throw error;
  }
}

export async function saveTeamSwapInTransaction(tx:Prisma.TransactionClient,actorId:string,raw:unknown) {
  const input=inputSchema.parse(raw);
  await lockAuthorization(tx);
  const lookup=await tx.schedule_proposals.findUnique({where:{id:input.proposalId},select:{season_id:true}});
  if(!lookup) throw new AuthorizationError();
  await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${lookup.season_id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sports_management.schedule_proposals WHERE id=${input.proposalId}::uuid FOR UPDATE`;
  const row=await tx.schedule_proposals.findUniqueOrThrow({where:{id:input.proposalId},select:{id:true,season_id:true,version:true,status:true,parameters:true,competition_rule_id:true,seasons:{select:{status:true,version:true}}}});
  const grants=await assertPermission(tx,actorId,{module:"scheduling",action:"UPDATE",context:{seasonId:row.season_id}});
  if(!grants.some(grant=>!grant.clubId)) throw new AuthorizationError();
  if(row.version!==input.expectedVersion) return {code:"STALE_PROPOSAL" as const};
  if(row.status!=="DRAFT"||row.seasons.status==="CLOSED") return {code:"INVALID_PROPOSAL_TRANSITION" as const};
  const proposal=storedProposalSchema.parse(row.parameters);
  if(proposal.seasonVersion!==row.seasons.version) return {code:"STALE_CONFIGURATION" as const};
  if(proposal.ruleId!==row.competition_rule_id) throw new AuthorizationError();
  let updated=proposal.matches;
  try {
    for(const swap of input.swaps) updated=proposeTeamSwap(updated,swap.round,swap.first,swap.second)
      .map(item=>({...item.before,home:item.home,away:item.away}));
  } catch { return {code:"INVALID_TEAM_SWAP" as const}; }
  const candidates=updated.map((match,index)=>match.home!==proposal.matches[index].home || match.away!==proposal.matches[index].away
    ? {...pendingEncounter({round:match.round,matchdayId:match.matchdayId,home:match.home,away:match.away}),factors:["TEAM_CHANGED"]}
    : proposal.matches[index]);
  if(candidates.every((match,index)=>match===proposal.matches[index])) return {code:"NO_CHANGES" as const};
  const result=await validateScheduleProposalInTransaction(tx,actorId,{proposalId:row.id,expectedSeasonVersion:proposal.seasonVersion,
    matches:candidates.map(({round,matchdayId,home,away,venueId,start})=>({round,matchdayId,home,away,venueId,start}))},"UPDATE",input.swaps);
  if(!result.ok) return {code:result.code,conflicts:result.conflicts};
  const parameters=storedProposalSchema.parse({...proposal,matches:result.matches.map((match,index)=>({...candidates[index],...match})),
    byes:result.byes,preferenceOptimal:false});
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${input.reason},true)`;
  const changed=await tx.schedule_proposals.updateMany({where:{id:row.id,version:row.version,status:"DRAFT"},
    data:{parameters:parameters as Prisma.InputJsonValue,version:{increment:1}}});
  if(changed.count!==1) return {code:"STALE_PROPOSAL" as const};
  await tx.audit_logs.create({data:{user_id:actorId,action:"UPDATE",table_name:"schedule_proposals",entity_id:row.id,reason:input.reason,
    previous_data:{version:row.version,parameters:proposal} as Prisma.InputJsonValue,
    new_data:{version:row.version+1,parameters} as Prisma.InputJsonValue},select:{id:true}});
  return {code:"ADJUSTMENT_SAVED" as const,version:row.version+1};
}
