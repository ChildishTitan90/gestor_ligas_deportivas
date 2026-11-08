import "server-only";
import {createHash} from "node:crypto";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {getPrisma} from "@/server/db/prisma";
import {AuthorizationError,assertPermission,lockAuthorization} from "@/server/auth/authorization";
import {readPlayerPolicy} from "@/features/competitions/server/player-policy";
import {CompetitionError} from "@/features/competitions/server/configuration";
import {evaluatePlayerAge,isPlayerRegistrationDay} from "@/features/competitions/player-policy";
import {playerPathwaySchema,playerCategoryParticipationSchema,participationReviewSchema,participationStatusSchema,type EligibilityAssessment} from "../category-participation";
import {assessPlayerEligibility,lockEligibilityIdentity} from "./eligibility-assessment";
import {adjacentBirthDates} from "../identity-rules";
import {assertPlayerRegistrationRead,lockPlayerTeamContext} from "./access";
import {findPossibleIdentityMatches,identityFromPerson,personIdentitySelect} from "./identity-matches";
import {hasCurrentIdentityResolution} from "./identity-resolution";

export class CategoryParticipationError extends Error{
  constructor(public code:string,public status=409){super(code);}
}
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function translate(error:unknown):never{
  if(error instanceof CategoryParticipationError || error instanceof AuthorizationError)throw error;
  if(error instanceof CompetitionError)throw new CategoryParticipationError("PLAYER_POLICY_PENDING");
  if(error instanceof Prisma.PrismaClientKnownRequestError){
    if(error.code==="P2002")throw new CategoryParticipationError("PARTICIPATION_CONFLICT");
    if(error.code==="P2034" || error.code==="P2028")throw new CategoryParticipationError("RETRY_REQUIRED",503);
  }
  const databaseError=error as {meta?:{driverAdapterError?:{cause?:{originalMessage?:string}}}};
  if(databaseError?.meta?.driverAdapterError?.cause?.originalMessage?.includes("PLAYER_PARTICIPATION_WINDOW"))throw new CategoryParticipationError("REGISTRATION_WINDOW_CLOSED");
  throw new CategoryParticipationError("SERVICE_UNAVAILABLE",503);
}

export async function readPlayerPathwayForActor(actorId:string,seasonId:string){
  if(!z.uuid().safeParse(seasonId).success)throw new CategoryParticipationError("VALIDATION_ERROR",400);
  return getPrisma().$transaction(async tx=>{
    await assertPermission(tx,actorId,{module:"competitions",action:"READ",context:{seasonId}});
    return tx.player_category_levels.findMany({where:{season_id:seasonId},select:{season_category_id:true,pathway_code:true,level:true},orderBy:[{pathway_code:"asc"},{level:"asc"}]});
  });
}
export async function configurePlayerPathwayForActor(actorId:string,seasonId:string,input:unknown){
  const parsed=playerPathwaySchema.safeParse(input);
  if(!parsed.success || !z.uuid().safeParse(seasonId).success)throw new CategoryParticipationError("VALIDATION_ERROR",400);
  const data=parsed.data,categories=[...data.categories].sort((a,b)=>a.level-b.level);
  try{return await getPrisma().$transaction(async tx=>{
    await lockAuthorization(tx);
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
    for(const action of ["UPDATE","APPROVE"] as const)await assertPermission(tx,actorId,{module:"competitions",action,context:{seasonId}});
    const season=await tx.seasons.findUniqueOrThrow({where:{id:seasonId},select:{version:true,status:true,competition_starts_at:true}});
    const existing=await tx.player_category_levels.findMany({where:{season_id:seasonId,pathway_code:data.pathwayCode},orderBy:{level:"asc"}});
    if(existing.length){
      if(existing.length===categories.length && existing.every((r,i)=>r.season_category_id===categories[i].seasonCategoryId && r.level===categories[i].level))return {seasonVersion:season.version,replayed:true};
      throw new CategoryParticipationError("PATHWAY_ALREADY_CONFIGURED");
    }
    if(season.version!==data.expectedSeasonVersion)throw new CategoryParticipationError("STALE_VERSION");
    if(season.status!=="PLANNED" || season.competition_starts_at)throw new CategoryParticipationError("CONTEXT_NOT_AVAILABLE");
    const rows=await tx.season_categories.findMany({where:{id:{in:categories.map(c=>c.seasonCategoryId)},season_id:seasonId},select:{id:true,type:true}});
    if(rows.length!==categories.length || new Set(rows.map(c=>c.type)).size!==1)throw new CategoryParticipationError("INCOMPATIBLE_CATEGORIES");
    if(await tx.player_category_levels.count({where:{season_category_id:{in:categories.map(c=>c.seasonCategoryId)}}}))throw new CategoryParticipationError("CATEGORY_ALREADY_CONFIGURED");
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${data.reason},true)`;
    await tx.player_category_levels.createMany({data:categories.map(c=>({season_category_id:c.seasonCategoryId,season_id:seasonId,pathway_code:data.pathwayCode,level:c.level,configured_by:actorId}))});
    const updated=await tx.seasons.update({where:{id:seasonId},data:{version:{increment:1}},select:{version:true}});
    return {seasonVersion:updated.version,replayed:false};
  },{timeout:15000});}catch(error){translate(error);}
}

const participationSelect={id:true,origin_registration_id:true,target_season_team_id:true,target_season_category_id:true,status:true,version:true,eligibility_fingerprint:true,review_event_id:true,request_hash:true} satisfies Prisma.player_category_participationsSelect;
function receipt(row:Prisma.player_category_participationsGetPayload<{select:typeof participationSelect}>,replayed:boolean,assessment?:EligibilityAssessment){
  return {id:row.id,originRegistrationId:row.origin_registration_id,targetSeasonTeamId:row.target_season_team_id,targetSeasonCategoryId:row.target_season_category_id,status:participationStatusSchema.parse(row.status),version:row.version,
    sportsEligible:row.status==="AUTHORIZED" && !!assessment?.ready && row.eligibility_fingerprint===assessment.fingerprint,assessment,replayed};
}
export async function readCategoryParticipationsForActor(actorId:string,registrationId:string){
  if(!z.uuid().safeParse(registrationId).success)throw new CategoryParticipationError("VALIDATION_ERROR",400);
  return getPrisma().$transaction(tx=>readCategoryParticipationsInTransaction(tx,actorId,registrationId),{isolationLevel:"RepeatableRead",timeout:20000});
}
export async function readCategoryParticipationsInTransaction(tx:Prisma.TransactionClient,actorId:string,registrationId:string){
    const origin=await tx.player_registrations.findUnique({where:{id:registrationId},select:{season_team_id:true}});
    if(!origin)throw new AuthorizationError();
    const context=await assertPlayerRegistrationRead(tx,actorId,registrationId,origin.season_team_id);
    const rows=await tx.player_category_participations.findMany({where:{origin_registration_id:registrationId},select:participationSelect,orderBy:{id:"asc"}});
    const result=[];
    for(const row of rows){const {row:target}=await lockPlayerTeamContext(tx,actorId,row.target_season_team_id,"READ");const assessment = context.seasonStatus === "CLOSED" || target.seasonStatus === "CLOSED"
        ? undefined : await assessPlayerEligibility(tx,registrationId,[context,target],true);
      result.push(receipt(row,true,assessment));}
    return result;
}
export async function createCategoryParticipationForActor(actorId:string,registrationId:string,input:unknown){
  const parsed=playerCategoryParticipationSchema.safeParse(input);
  if(!parsed.success || !z.uuid().safeParse(registrationId).success)throw new CategoryParticipationError("VALIDATION_ERROR",400);
  const data=parsed.data,requestHash=digest([registrationId,data.targetSeasonTeamId,data.reason]);
  try{return await getPrisma().$transaction(async tx=>{
    const initial=await tx.player_registrations.findUnique({where:{id:registrationId},select:{season_team_id:true,people:{select:{birth_date:true}}}});
    if(!initial)throw new AuthorizationError();
    const {row:origin}=await lockPlayerTeamContext(tx,actorId,initial.season_team_id,"CREATE");
    await assertPlayerRegistrationRead(tx,actorId,registrationId,initial.season_team_id);
    const {row:target}=await lockPlayerTeamContext(tx,actorId,data.targetSeasonTeamId,"CREATE");
    await lockPlayerTeamContext(tx,actorId,data.targetSeasonTeamId,"READ");
    if(origin.clubId!==target.clubId || origin.seasonId!==target.seasonId)throw new CategoryParticipationError("INCOMPATIBLE_CONTEXT");
    if(initial.people.birth_date)for(const date of adjacentBirthDates(initial.people.birth_date.toISOString().slice(0,10)))await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-97:birth:${date}`},0))::text`;
    await tx.$queryRaw`SELECT pr.id FROM sports_management.player_registrations pr JOIN sports_management.people p ON p.id=pr.person_id WHERE pr.id=${registrationId}::uuid FOR UPDATE OF pr,p`;
    const reg=await tx.player_registrations.findUniqueOrThrow({where:{id:registrationId},select:{status:true,withdrawn_at:true,person_id:true,identity_review_status:true,people:{select:personIdentitySelect}}});
    const prior=await tx.player_category_participations.findUnique({where:{requested_by_request_key:{requested_by:actorId,request_key:data.operationKey}},select:participationSelect});
    if(prior){if(prior.request_hash!==requestHash)throw new CategoryParticipationError("PARTICIPATION_CONFLICT");return receipt(prior,true,await assessPlayerEligibility(tx,registrationId,[origin,target],true));}
    const existing=await tx.player_category_participations.findUnique({where:{origin_registration_id_target_season_category_id:{origin_registration_id:registrationId,target_season_category_id:target.seasonCategoryId}},select:participationSelect});
    if(existing){if(existing.request_hash!==requestHash)throw new CategoryParticipationError("PARTICIPATION_CONFLICT");return receipt(existing,true,await assessPlayerEligibility(tx,registrationId,[origin,target],true));}
    if(reg.withdrawn_at || !["INELIGIBLE","ACTIVE"].includes(reg.status) || [origin,target].some(c=>c.teamStatus==="WITHDRAWN" || c.seasonStatus==="CLOSED" || c.affiliationStatus!=="APPROVED" || (!c.categoryAuthorized || !c.operational)))throw new CategoryParticipationError("CONTEXT_NOT_AVAILABLE");
    const levels=await tx.player_category_levels.findMany({where:{season_category_id:{in:[origin.seasonCategoryId,target.seasonCategoryId]}}});
    const from=levels.find(l=>l.season_category_id===origin.seasonCategoryId),to=levels.find(l=>l.season_category_id===target.seasonCategoryId);
    if(!from || !to)throw new CategoryParticipationError("PATHWAY_NOT_CONFIGURED");
    if(from.pathway_code!==to.pathway_code || to.level!==from.level+1)throw new CategoryParticipationError("SUPERIOR_CATEGORY_REQUIRED");
    const birth=reg.people.birth_date?.toISOString().slice(0,10);if(!birth)throw new CategoryParticipationError("IDENTITY_NOT_READY");
    const matches=await findPossibleIdentityMatches(tx,identityFromPerson(reg.people),reg.person_id);
    if((reg.identity_review_status==="REQUIRED" || matches.length>0) && !await hasCurrentIdentityResolution(tx,registrationId,reg.person_id,matches))throw new CategoryParticipationError("IDENTITY_REVIEW_REQUIRED");
    const policies=[];
    for(const context of [origin,target])policies.push(await readPlayerPolicy(tx,context.seasonId,context.seasonCategoryId));
    const [clock]=await tx.$queryRaw<{now:Date}[]>`SELECT sports_management.player_participation_now() AS now`;
    for(const policy of policies){
      if(evaluatePlayerAge(policy,birth).status!=="ORDINARY_RANGE")throw new CategoryParticipationError("AGE_REQUIRES_REVIEW");
      if(!isPlayerRegistrationDay(policy,clock.now))throw new CategoryParticipationError("REGISTRATION_WINDOW_CLOSED");
    }
    if(await tx.sanctions.findFirst({where:{blocks_participation:true,starts_at:{lte:clock.now},AND:[{OR:[{ends_at:null},{ends_at:{gt:clock.now}}]},{OR:[{player_registrations:{person_id:reg.person_id}},{season_team_id:{in:[origin.seasonTeamId,target.seasonTeamId]}}]}]},select:{id:true}}))throw new CategoryParticipationError("PARTICIPATION_BLOCKED");
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${data.reason},true)`;
    const created=await tx.player_category_participations.create({data:{origin_registration_id:registrationId,season_id:origin.seasonId,club_id:origin.clubId,target_season_team_id:target.seasonTeamId,target_season_category_id:target.seasonCategoryId,requested_by:actorId,request_key:data.operationKey,request_hash:requestHash},select:participationSelect});
    return receipt(created,false);
  },{timeout:15000});}catch(error){translate(error);}
}

/** Revisión con versión, huella y acuse; una lectura nunca autoriza por efecto lateral. */
export async function reviewCategoryParticipationForActor(actorId:string,participationId:string,input:unknown){
  const parsed=participationReviewSchema.safeParse(input);
  if(!parsed.success || !z.uuid().safeParse(participationId).success)throw new CategoryParticipationError("VALIDATION_ERROR",400);
  const data=parsed.data,hash=digest(["participation-review:v1",actorId,data.operationKey]);
  const eventId=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const requestHash=digest([participationId,data]);
  try{return await getPrisma().$transaction(async tx=>{
    const initial=await tx.player_category_participations.findUnique({where:{id:participationId},select:participationSelect});
    if(!initial)throw new AuthorizationError();
    const reg=await tx.player_registrations.findUniqueOrThrow({where:{id:initial.origin_registration_id},select:{season_team_id:true}});
    const {row:origin}=await lockPlayerTeamContext(tx,actorId,reg.season_team_id,"APPROVE");
    await assertPlayerRegistrationRead(tx,actorId,initial.origin_registration_id,reg.season_team_id);
    const {row:target}=await lockPlayerTeamContext(tx,actorId,initial.target_season_team_id,"APPROVE");
    await lockPlayerTeamContext(tx,actorId,initial.target_season_team_id,"READ");
    await lockEligibilityIdentity(tx,initial.origin_registration_id);
    await tx.$queryRaw`SELECT id FROM sports_management.player_category_participations WHERE id=${participationId}::uuid FOR UPDATE`;
    const current=await tx.player_category_participations.findUniqueOrThrow({where:{id:participationId},select:participationSelect});
    const assessment=await assessPlayerEligibility(tx,current.origin_registration_id,[origin,target],true);
    const prior=await tx.audit_logs.findUnique({where:{id:eventId},select:{user_id:true,entity_id:true,new_data:true,action:true}});
    if(prior){if(prior.user_id!==actorId || prior.action!=="PLAYER_PARTICIPATION_REVIEWED" || prior.entity_id!==participationId || (prior.new_data as {requestHash:string}).requestHash!==requestHash)throw new CategoryParticipationError("PARTICIPATION_CONFLICT");return receipt(current,true,assessment);}
    if(data.expectedVersion!==current.version || data.fingerprint!==assessment.fingerprint)throw new CategoryParticipationError("STALE_ELIGIBILITY");
    if(data.decision==="AUTHORIZE" && !assessment.ready)throw new CategoryParticipationError("ELIGIBILITY_NOT_READY");
    const status=data.decision==="AUTHORIZE"?"AUTHORIZED":"WITHDRAWN",version=current.version+1,fingerprint=status==="AUTHORIZED"?assessment.fingerprint:null;
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${data.reason},true)`;
    await tx.audit_logs.create({data:{id:eventId,user_id:actorId,action:"PLAYER_PARTICIPATION_REVIEWED",table_name:"player_category_participations",entity_id:participationId,reason:data.reason,previous_data:{status:current.status,version:current.version},new_data:{status,version,fingerprint,requestHash,decision:data.decision}}});
    const updated=await tx.player_category_participations.updateMany({where:{id:participationId,version:current.version},data:{status,version,eligibility_fingerprint:fingerprint,review_event_id:eventId}});
    if(updated.count!==1)throw new CategoryParticipationError("STALE_ELIGIBILITY");
    return receipt(await tx.player_category_participations.findUniqueOrThrow({where:{id:participationId},select:participationSelect}),false,assessment);
  },{timeout:20000});}catch(error){translate(error);}
}
