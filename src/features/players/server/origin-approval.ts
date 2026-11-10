import "server-only";
import {z} from "zod";
import {getPrisma} from "@/server/db/prisma";
import {AuthorizationError} from "@/server/auth/authorization";
import {originApprovalSchema} from "../category-participation";
import {assertPlayerRegistrationRead,lockPlayerTeamContext} from "./access";
import {CategoryParticipationError} from "./category-participations";
import {assessPlayerEligibility,lockEligibilityIdentity,eligibilityDigest} from "./eligibility-assessment";

export async function approvePlayerOriginForActor(actorId:string,id:string,input:unknown){
  const parsed=originApprovalSchema.safeParse(input);
  if(!parsed.success || !z.uuid().safeParse(id).success)throw new CategoryParticipationError("VALIDATION_ERROR",400);
  const data=parsed.data,hash=eligibilityDigest(["origin-approval:v1",actorId,data.operationKey]);
  const eventId=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const requestHash=eligibilityDigest([id,data]);
  return getPrisma().$transaction(async tx=>{
    const initial=await tx.player_registrations.findUnique({where:{id},select:{season_team_id:true}});
    if(!initial)throw new AuthorizationError();
    const {row:context}=await lockPlayerTeamContext(tx,actorId,initial.season_team_id,"APPROVE");
    await assertPlayerRegistrationRead(tx,actorId,id,initial.season_team_id);
    await lockEligibilityIdentity(tx,id);
    const reg=await tx.player_registrations.findUniqueOrThrow({where:{id},select:{status:true,withdrawn_at:true,people:{select:{identity_version:true}}}});
    const prior=await tx.audit_logs.findUnique({where:{id:eventId},select:{entity_id:true,action:true,new_data:true,user_id:true}});
    if(prior){if(prior.entity_id!==id || prior.user_id!==actorId || prior.action!=="PLAYER_MANUAL_ACTIVATED" || (prior.new_data as {requestHash:string}).requestHash!==requestHash)throw new CategoryParticipationError("PARTICIPATION_CONFLICT");return {registrationId:id,status:reg.status,replayed:true};}
    const assessment=await assessPlayerEligibility(tx,id,[context]);
    if(reg.status!=="INELIGIBLE" || reg.withdrawn_at)throw new CategoryParticipationError("CONTEXT_NOT_AVAILABLE");
    if(data.fingerprint!==assessment.fingerprint)throw new CategoryParticipationError("STALE_ELIGIBILITY");
    if(!assessment.ready)throw new CategoryParticipationError("ELIGIBILITY_NOT_READY");
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${data.reason},true)`;
    await tx.player_registrations.update({where:{id},data:{status:"ACTIVE",identity_review_status:"NOT_REQUIRED"}});
    await tx.player_status_history.create({data:{registration_id:id,previous_status:"INELIGIBLE",new_status:"ACTIVE",user_id:actorId,reason:data.reason}});
    await tx.audit_logs.create({data:{id:eventId,user_id:actorId,action:"PLAYER_MANUAL_ACTIVATED",table_name:"player_registrations",entity_id:id,reason:data.reason,new_data:{requestHash,eligibilityFingerprint:assessment.fingerprint,identityVersion:reg.people.identity_version}}});
    return {registrationId:id,status:"ACTIVE",replayed:false};
  },{timeout:20000});
}
