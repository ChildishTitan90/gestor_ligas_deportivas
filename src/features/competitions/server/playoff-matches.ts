import "server-only";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { playoffHomeOrder, playoffRoundDates, playoffRulesSchema } from "../playoff-qualification";
import { previewPlayoffQualifiersInTransaction } from "./playoff-qualifiers";

const schema = z.strictObject({ seasonId:z.uuid(), categoryId:z.uuid(), reason:z.string().trim().min(8).max(500), homeChoices:z.record(z.uuid(), z.uuid()).default({}), round:z.enum(["quarterfinals","semifinals","final"]).default("quarterfinals") });

/** Creates draft quarterfinals only: a separate authorized action schedules and reserves resources. */
export async function createPlayoffQuarterfinals(input: unknown) {
  const actor=await requireOperationalUser();
  return createPlayoffQuarterfinalsForActor(actor.id,input);
}
export async function createPlayoffQuarterfinalsForActor(actorId:string,input:unknown) {
  const data=schema.parse(input);
  return getPrisma().$transaction(async tx=>{
    await lockAuthorization(tx);
    await assertPermission(tx,actorId,{module:"scheduling",action:"UPDATE",context:{seasonId:data.seasonId}});
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${data.seasonId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM sports_management.season_categories WHERE id=${data.categoryId}::uuid AND season_id=${data.seasonId}::uuid FOR UPDATE`;
    const stages=await tx.competition_stages.findMany({where:{season_id:data.seasonId,season_category_id:data.categoryId},select:{id:true,competition_rule_id:true,format:true}});
    const stage=stages.find(s=>s.format && typeof s.format==="object" && !Array.isArray(s.format) && s.format.kind==="PLAYOFF_8");
    if(!stage) throw Error("PLAYOFF_BRACKET_REQUIRED");
    const qualifiers=await previewPlayoffQualifiersInTransaction(tx,actorId,data.seasonId,data.categoryId);
    if((stage.format as {fingerprint?:string}).fingerprint!==qualifiers.fingerprint) throw Error("PLAYOFF_STANDINGS_CHANGED");
    const rule=await tx.competition_rule_parameters.findFirst({where:{competition_rule_id:stage.competition_rule_id,parameter_key:"calendar",requires_validation:false,validated_by:{not:null}},select:{parameter_value:true}});
    const parsed=z.object({playoff:playoffRulesSchema.extend({regularDeadline:z.iso.date(),dates:z.array(z.iso.date())})}).safeParse(rule?.parameter_value);
    if(!parsed.success) throw Error("PLAYOFF_DATES_REQUIRED");
    const schedule=playoffRoundDates(parsed.data.playoff.format,parsed.data.playoff.dates);
    if(!schedule.ok) throw Error(schedule.code);
    const season=await tx.seasons.findUniqueOrThrow({where:{id:data.seasonId},select:{status:true,start_date:true,end_date:true}});
    if(season.status==="CLOSED") throw Error("SEASON_CLOSED");
    const roundDates=schedule.dates[data.round];
    if(roundDates.some(date=>date<=parsed.data.playoff.regularDeadline || date<season.start_date.toISOString().slice(0,10) || date>season.end_date.toISOString().slice(0,10))) throw Error("INVALID_PLAYOFF_DATES");
    const firstNumber=data.round==="quarterfinals"?1:data.round==="semifinals"?5:7;
    const expectedCount=data.round==="quarterfinals"?4:data.round==="semifinals"?2:1;
    const brackets=await tx.brackets.findMany({where:{stage_id:stage.id,number:{gte:firstNumber,lt:firstNumber+expectedCount}},select:{id:true,number:true,team_a_id:true,team_b_id:true,bracket_matches:{select:{id:true}}},orderBy:{number:"asc"}});
    if(brackets.length!==expectedCount || brackets.some((b,i)=>b.number!==i+firstNumber || !b.team_a_id || !b.team_b_id)) throw Error("PLAYOFF_PREVIOUS_ROUND_INCOMPLETE");
    if(brackets.some(b=>b.bracket_matches.length)) throw Error("PLAYOFF_MATCHES_ALREADY_CREATED");
    const planned=brackets.flatMap(b=>{
      const a=qualifiers.qualified.find(t=>t.teamId===b.team_a_id),bteam=qualifiers.qualified.find(t=>t.teamId===b.team_b_id);
      if(!a || !bteam) throw Error("PLAYOFF_STANDINGS_CHANGED");
      let order=playoffHomeOrder(a,bteam,parsed.data.playoff.format[data.round]);
      if(!order.ok && order.code==="HOME_TEAM_UNDECIDED") {
        const selected=data.homeChoices[b.id];
        if(selected!==a.teamId && selected!==bteam.teamId) throw Error("HOME_TEAM_UNDECIDED");
        order=playoffHomeOrder({...a,rank:selected===a.teamId?1:2},{...bteam,rank:selected===bteam.teamId?1:2},parsed.data.playoff.format[data.round]);
      }
      if(!order.ok) throw Error(order.code);
      return order.matches.map((match,index)=>({bracketId:b.id,number:b.number,leg:index+1,date:roundDates[index],...match}));
    });
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${data.reason},true)`;
    const days=new Map<string,string>();
    for(const date of roundDates) {
      const at=new Date(`${date}T00:00:00.000Z`);
      const existing=await tx.matchdays.findMany({where:{season_id:data.seasonId,start_date:{lte:at},end_date:{gte:at}},select:{id:true}});
      if(existing.length>1) throw Error("AMBIGUOUS_MATCHDAY");
      if(existing.length===1) { days.set(date,existing[0].id); continue; }
      const last=await tx.matchdays.aggregate({where:{season_id:data.seasonId},_max:{number:true}});
      const day=await tx.matchdays.create({data:{season_id:data.seasonId,number:(last._max.number??0)+1,start_date:at,end_date:at},select:{id:true}});
      days.set(date,day.id);
    }
    const draftStatus=await tx.match_statuses.findUniqueOrThrow({where:{code:"DRAFT"},select:{id:true}});
    for(const match of planned) {
      const home=await tx.season_teams.findFirstOrThrow({where:{id:match.home,season_id:data.seasonId},select:{group_id:true}});
      if(!home.group_id) throw Error("INVALID_PLAYOFF_TEAMS");
      const [created]=await tx.$queryRaw<{id:string}[]>`INSERT INTO sports_management.matches (season_id,group_id,matchday_id,stage_id,number,home_team_id,away_team_id,status_id) VALUES (${data.seasonId}::uuid,${home.group_id}::uuid,${days.get(match.date)!}::uuid,${stage.id}::uuid,${`LIG-${stage.id}-${match.number}-${match.leg}`},${match.home}::uuid,${match.away}::uuid,${draftStatus.id}::uuid) RETURNING id`;
      await tx.bracket_matches.create({data:{bracket_id:match.bracketId,match_id:created.id,leg_number:match.leg}});
    }
    return {stageId:stage.id,created:planned.length};
  },{isolationLevel:"Serializable",timeout:30000});
}
