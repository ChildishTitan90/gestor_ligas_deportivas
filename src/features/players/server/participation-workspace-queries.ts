import "server-only";
import {Prisma} from "@prisma/client";
import {getPrisma} from "@/server/db/prisma";
import {requireOperationalUser} from "@/server/auth/session";
import {getPermissionGrants,AuthorizationError} from "@/server/auth/authorization";
import {z} from "zod";
import {assertPlayerRegistrationRead,lockPlayerTeamContext} from "./access";
import {playerClubScope} from "./player-scope";
import {readRegistrationLabels} from "./registration-labels";
import {assessPlayerEligibility,type PlayerTeamContext} from "./eligibility-assessment";
import {readCategoryParticipationsInTransaction} from "./category-participations";

async function can(tx:Prisma.TransactionClient,actorId:string,teamId:string,action:"CREATE"|"APPROVE"){
  try{await lockPlayerTeamContext(tx,actorId,teamId,action);return true;}catch(error){if(!(error instanceof AuthorizationError))throw error;return false;}
}
async function workspaceScope(tx:Prisma.TransactionClient,actorId:string){
  const read=await getPermissionGrants(tx,actorId,"players","READ"),create=await getPermissionGrants(tx,actorId,"players","CREATE"),approve=await getPermissionGrants(tx,actorId,"players","APPROVE");
  if(!read.length || (!create.length && !approve.length))throw new AuthorizationError();
  return {AND:[playerClubScope(read),playerClubScope([...create,...approve])],status:"ACTIVE",leagues:{is_active:true}} satisfies Prisma.clubsWhereInput;
}
export async function canAccessPlayerParticipations(){
  const actor=await requireOperationalUser();
  return getPrisma().$transaction(async tx=>(await tx.clubs.count({where:await workspaceScope(tx,actor.id)}))>0);
}
export async function getPlayerParticipationDirectory(){return readPlayerParticipationDirectoryForActor((await requireOperationalUser()).id);}
export async function readPlayerParticipationDirectoryForActor(actorId:string){
  return getPrisma().$transaction(async tx=>{
    const scope=await workspaceScope(tx,actorId);
    const registrations=await tx.player_registrations.findMany({where:{season_teams:{teams:{clubs:scope}}},select:{id:true,season_team_id:true,status:true},orderBy:[{registered_at:"desc"},{id:"asc"}]});
    const rows=[];
    for(const row of registrations){
      try{
        await assertPlayerRegistrationRead(tx,actorId,row.id,row.season_team_id);
        const participations=await tx.player_category_participations.findMany({where:{origin_registration_id:row.id},select:{status:true,target_season_team_id:true}});
        const statuses=[];
        for(const participation of participations){try{await lockPlayerTeamContext(tx,actorId,participation.target_season_team_id,"READ");statuses.push(participation.status);}catch(error){if(!(error instanceof AuthorizationError))throw error;}}
        rows.push({...await readRegistrationLabels(tx,row.id),status:row.status,pending:statuses.filter(s=>s==="PENDING_ELIGIBILITY").length,authorized:statuses.filter(s=>s==="AUTHORIZED").length,withdrawn:statuses.filter(s=>s==="WITHDRAWN").length});
      }catch(error){if(!(error instanceof AuthorizationError))throw error;}
    }
    return {actorId,rows};
  },{isolationLevel:"RepeatableRead",timeout:25000});
}
export async function getPlayerParticipationWorkspace(registrationId:string){return readPlayerParticipationWorkspaceForActor((await requireOperationalUser()).id,registrationId);}
export async function readPlayerParticipationWorkspaceForActor(actorId:string,registrationId:string){
  if(!z.uuid().safeParse(registrationId).success)throw new AuthorizationError();
  return getPrisma().$transaction(async tx=>{
    const initial=await tx.player_registrations.findUnique({where:{id:registrationId},select:{season_team_id:true,status:true}});
    if(!initial)throw new AuthorizationError();
    const origin=await assertPlayerRegistrationRead(tx,actorId,registrationId,initial.season_team_id);
    const canRequest=await can(tx,actorId,initial.season_team_id,"CREATE"),canApprove=await can(tx,actorId,initial.season_team_id,"APPROVE");
    if(!canRequest && !canApprove)throw new AuthorizationError();
    const closed = origin.seasonStatus === "CLOSED";
    const levels=await tx.player_category_levels.findMany({where:{season_id:origin.seasonId},select:{season_category_id:true,pathway_code:true,level:true}});
    const from=levels.find(l=>l.season_category_id===origin.seasonCategoryId);
    const to=levels.find(l=>l.pathway_code===from?.pathway_code && l.level===(from?.level ?? -2)+1);
    const candidates=to && canRequest && !closed?await tx.season_teams.findMany({where:{club_id:origin.clubId,season_id:origin.seasonId,status:{not:"WITHDRAWN"},groups:{season_category_id:to.season_category_id}},select:{id:true},orderBy:{id:"asc"}}):[];
    const targets=[];
    for(const candidate of candidates){try{const {row:target}=await lockPlayerTeamContext(tx,actorId,candidate.id,"CREATE");await lockPlayerTeamContext(tx,actorId,candidate.id,"READ");if(target.affiliationStatus==="APPROVED" && (target.categoryAuthorized && target.operational))targets.push(await targetLabels(tx,target));}catch(error){if(!(error instanceof AuthorizationError))throw error;}}
    const items=await readCategoryParticipationsInTransaction(tx,actorId,registrationId);
    const participations=[];
    for(const item of items){const {row:target}=await lockPlayerTeamContext(tx,actorId,item.targetSeasonTeamId,"READ");participations.push({...item,...await targetLabels(tx,target),canReview:!closed && canApprove && await can(tx,actorId,item.targetSeasonTeamId,"APPROVE")});}
    return {actorId,registrationId,player:await readRegistrationLabels(tx,registrationId),source:{status:initial.status,pathwayCode:from?.pathway_code ?? null,level:from?.level ?? null,canApprove:!closed && canApprove,assessment:closed ? null : await assessPlayerEligibility(tx,registrationId,[origin])},canRequest:!closed && canRequest,targets,participations};
  },{isolationLevel:"RepeatableRead",timeout:25000});
}
async function targetLabels(tx:Prisma.TransactionClient,context:PlayerTeamContext){
  const [row]=await tx.$queryRaw<{id:string;team:string;category:string}[]>`SELECT st.id,t.name AS team,c.name AS category FROM sports_management.season_teams st JOIN sports_management.teams t ON t.id=st.team_id JOIN sports_management.season_categories sc ON sc.id=${context.seasonCategoryId}::uuid JOIN sports_management.categories c ON c.id=sc.category_id WHERE st.id=${context.seasonTeamId}::uuid`;
  return {targetId:row.id,targetTeam:row.team,targetCategory:row.category,targetCategoryId:context.seasonCategoryId};
}
