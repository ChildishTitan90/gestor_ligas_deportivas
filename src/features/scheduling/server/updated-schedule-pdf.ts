import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { createSchedulePdf } from "../schedule-pdf";
import { storedProposalSchema } from "../stored-proposal";
import { SchedulePdfUnavailable } from "./schedule-pdf";

const snapshotSchema = z.object({league:z.string(),season:z.string(),category:z.string(),group:z.string(),timezone:z.string(),
  version:z.number().int().min(2),generatedAt:z.iso.datetime(),matches:z.array(z.object({round:z.number().int(),home:z.string(),away:z.string(),venue:z.string(),start:z.iso.datetime().nullable(),status:z.string().optional()})).min(1),
  byes:z.array(z.object({round:z.number().int(),team:z.string()}))});

/** Se llama tras mover el partido y con la propuesta bloqueada, dentro de la misma transacción. */
export async function captureUpdatedSchedule(tx:Prisma.TransactionClient,proposalId:string,actorId:string,reason:string) {
  const proposal=await tx.schedule_proposals.findUnique({where:{id:proposalId},select:{status:true,season_id:true,parameters:true,
    seasons:{select:{name:true,leagues:{select:{name:true,timezone:true}}}}}});
  if(!proposal || proposal.status!=="APPROVED") throw new SchedulePdfUnavailable();
  const data=storedProposalSchema.parse(proposal.parameters);
  const group=await tx.groups.findFirstOrThrow({where:{id:data.groupId,season_id:proposal.season_id},select:{name:true,season_categories:{select:{categories:{select:{name:true}}}}}});
  const matches=await tx.matches.findMany({where:{schedule_proposal_id:proposalId,deleted_at:null},select:{home_team_id:true,away_team_id:true,matchday_id:true,venue_id:true,starts_at:true,
    matchdays:{select:{number:true}},match_statuses:{select:{code:true}},venues:{select:{name:true}}}});
  if(matches.length!==data.matches.length) throw new SchedulePdfUnavailable();
  const teams=await tx.season_teams.findMany({where:{season_id:proposal.season_id,id:{in:[...new Set([...matches.flatMap(m=>[m.home_team_id,m.away_team_id]),...data.byes.map(b=>b.teamId)])]}},select:{id:true,teams:{select:{name:true}}}});
  const names=new Map(teams.map(t=>[t.id,data.teamNames?.[t.id] ?? t.teams.name]));
  const count=await tx.audit_logs.count({where:{table_name:"schedule_proposals",entity_id:proposalId,action:"SCHEDULE_VERSION"}});
  const snapshot=snapshotSchema.parse({league:proposal.seasons.leagues.name,season:proposal.seasons.name,category:group.season_categories.categories.name,
    group:group.name,timezone:proposal.seasons.leagues.timezone,version:count+2,generatedAt:new Date().toISOString(),
    matches:matches.map(m=>({round:m.matchdays.number,home:names.get(m.home_team_id),away:names.get(m.away_team_id),venue:m.venues?.name ?? "Cancha pendiente",start:m.starts_at?.toISOString() ?? null,status:m.match_statuses.code})),
    byes:data.byes.map(b=>({round:b.round,team:names.get(b.teamId)}))});
  await tx.audit_logs.create({data:{user_id:actorId,table_name:"schedule_proposals",entity_id:proposalId,action:"SCHEDULE_VERSION",reason,new_data:snapshot}});
  return snapshot.version;
}

export async function updatedSchedulePdf(proposalId:unknown) {
  const {id:actorId}=await requireOperationalUser();
  return updatedSchedulePdfForActor(actorId,proposalId);
}

export async function updatedSchedulePdfForActor(actorId:string,proposalId:unknown) {
  const id=z.uuid().parse(proposalId);
  const snapshot=await getPrisma().$transaction(async tx=>{
    const proposal=await tx.schedule_proposals.findUnique({where:{id},select:{season_id:true,status:true}});
    if(!proposal)throw new AuthorizationError();
    const grants=await assertPermission(tx,actorId,{module:"scheduling",action:"READ",context:{seasonId:proposal.season_id}});
    if(!grants.some(g=>!g.clubId))throw new AuthorizationError();
    const records=await tx.audit_logs.findMany({where:{table_name:"schedule_proposals",entity_id:id,action:"SCHEDULE_VERSION"},select:{new_data:true}});
    if(proposal.status!=="APPROVED" || !records.length)throw new SchedulePdfUnavailable();
    const versions=records.map(record=>snapshotSchema.safeParse(record.new_data));
    if(versions.some(version=>!version.success))throw new SchedulePdfUnavailable();
    return versions.flatMap(version=>version.success?[version.data]:[]).sort((a,b)=>b.version-a.version)[0];
  },{isolationLevel:"RepeatableRead"});
  return createSchedulePdf({...snapshot,variant:"updated",generatedAt:new Date(snapshot.generatedAt)});
}
