import "server-only";
import { z } from "zod";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { storedProposalSchema } from "../stored-proposal";
import { createSchedulePdf, type SchedulePdfData } from "../schedule-pdf";

export class SchedulePdfUnavailable extends Error {}

export async function approvedSchedulePdf(proposalId:unknown) {
  const actor=await requireOperationalUser();
  return approvedSchedulePdfForActor(actor.id,proposalId);
}

export async function approvedSchedulePdfForActor(actorId:string,proposalId:unknown) {
  const id=z.uuid().parse(proposalId);
  const data=await getPrisma().$transaction(async tx=>{
    const row=await tx.schedule_proposals.findUnique({where:{id},select:{season_id:true,status:true,version:true,parameters:true,
      seasons:{select:{name:true,league_id:true,leagues:{select:{name:true,timezone:true}}}}}});
    if(!row)throw new AuthorizationError();
    const grants=await assertPermission(tx,actorId,{module:"scheduling",action:"READ",context:{seasonId:row.season_id}});
    if(!grants.some(grant=>!grant.clubId))throw new AuthorizationError();
    if(row.status!=="APPROVED")throw new SchedulePdfUnavailable();
    const stored=storedProposalSchema.safeParse(row.parameters);
    if(!stored.success || stored.data.matches.some(match=>!match.start || !match.venueId))throw new SchedulePdfUnavailable();
    const proposal=stored.data;
    const group=await tx.groups.findFirst({where:{id:proposal.groupId,season_id:row.season_id,season_category_id:proposal.categoryId},
      select:{name:true,season_categories:{select:{categories:{select:{name:true}}}}}});
    if(!group)throw new SchedulePdfUnavailable();
    const teamIds=[...new Set([...proposal.matches.flatMap(match=>[match.home,match.away]),...proposal.byes.map(bye=>bye.teamId)])];
    const venueIds=[...new Set(proposal.matches.flatMap(match=>match.venueId?[match.venueId]:[]))];
    const [teams,venues]=await Promise.all([
      tx.season_teams.findMany({where:{id:{in:teamIds},season_id:row.season_id},select:{id:true,teams:{select:{name:true}}}}),
      tx.venues.findMany({where:{id:{in:venueIds},league_id:row.seasons.league_id},select:{id:true,name:true}}),
    ]);
    const teamNames=new Map(teams.map(team=>[team.id,team.teams.name]));
    const venueNames=new Map(venues.map(venue=>[venue.id,venue.name]));
    const teamName=(teamId:string)=>proposal.teamNames?.[teamId] ?? teamNames.get(teamId);
    const matches=proposal.matches.map(match=>({round:match.round,home:teamName(match.home),away:teamName(match.away),
      venue:match.venueId ? proposal.venueNames?.[match.venueId] ?? venueNames.get(match.venueId) : undefined,start:match.start}));
    const byes=proposal.byes.map(bye=>({round:bye.round,team:teamName(bye.teamId)}));
    if(matches.some(match=>!match.home || !match.away || !match.venue || !match.start) || byes.some(bye=>!bye.team))
      throw new SchedulePdfUnavailable();
    return {league:row.seasons.leagues.name,season:row.seasons.name,category:group.season_categories.categories.name,
      group:group.name,timezone:row.seasons.leagues.timezone,version:1,generatedAt:new Date(),matches,byes} as SchedulePdfData;
  },{isolationLevel:"RepeatableRead",timeout:30000});
  return createSchedulePdf(data);
}
