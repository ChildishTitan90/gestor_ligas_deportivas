import "server-only";
import {z} from "zod";
import {getPrisma} from "@/server/db/prisma";
import {requireOperationalUser} from "@/server/auth/session";
import {assertPermission,AuthorizationError} from "@/server/auth/authorization";
import {playerPolicySchema} from "../schemas";

export async function getPlayerConfigurationWorkspace(seasonId:string){
  const actor=await requireOperationalUser();
  return readPlayerConfigurationWorkspaceForActor(actor.id,seasonId);
}
export async function readPlayerConfigurationWorkspaceForActor(actorId:string,seasonId:string){
  if(!z.uuid().safeParse(seasonId).success)throw new AuthorizationError();
  return getPrisma().$transaction(async tx=>{
    await assertPermission(tx,actorId,{module:"competitions",action:"READ",context:{seasonId}});
    const season=await tx.seasons.findUniqueOrThrow({where:{id:seasonId},select:{id:true,name:true,version:true,status:true,competition_starts_at:true}});
    const categories=await tx.season_categories.findMany({where:{season_id:seasonId},select:{id:true,type:true,player_policy:true,categories:{select:{name:true}}},orderBy:{id:"asc"}});
    const levels=await tx.player_category_levels.findMany({where:{season_id:seasonId},select:{season_category_id:true,pathway_code:true,level:true},orderBy:[{pathway_code:"asc"},{level:"asc"}]});
    async function allowed(action:"UPDATE"|"APPROVE"){try{await assertPermission(tx,actorId,{module:"competitions",action,context:{seasonId}});return true;}catch(error){if(!(error instanceof AuthorizationError))throw error;return false;}}
    return {actorId,season:{id:season.id,name:season.name,version:season.version,status:season.status},canEdit:season.status==="PLANNED" && !season.competition_starts_at && await allowed("UPDATE"),canApprove:await allowed("APPROVE"),
      categories:categories.map(row=>({id:row.id,type:row.type,name:row.categories.name,policy:playerPolicySchema.safeParse(row.player_policy).data ?? null})),levels};
  },{isolationLevel:"RepeatableRead",timeout:15000});
}
