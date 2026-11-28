import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { playoffRulesSchema, resolvePlayoffWinner } from "../playoff-qualification";

/** Must run in the result-confirmation transaction, after its report is confirmed. */
export async function advancePlayoffResultInTransaction(tx: Prisma.TransactionClient, matchId: string) {
  const link=await tx.bracket_matches.findUnique({where:{match_id:matchId},select:{bracket_id:true}});
  if(!link) return {code:"NOT_PLAYOFF" as const};
  await tx.$queryRaw`SELECT id FROM sports_management.brackets WHERE id=${link.bracket_id}::uuid FOR UPDATE`;
  const bracket=await tx.brackets.findUniqueOrThrow({where:{id:link.bracket_id},select:{id:true,number:true,team_a_id:true,team_b_id:true,winner_id:true,next_bracket_id:true,next_slot:true,competition_stages:{select:{format:true,competition_rule_id:true}},bracket_matches:{orderBy:{leg_number:"asc"},select:{leg_number:true,matches:{select:{home_team_id:true,away_team_id:true,match_statuses:{select:{code:true}},match_results:{select:{home_score:true,away_score:true,source:true,offending_team_id:true}},match_reports:{select:{status:true,confirmed_at:true}}}}}}}});
  const stageKind=z.object({kind:z.string()}).safeParse(bracket.competition_stages.format);
  if(!stageKind.success || stageKind.data.kind!=="PLAYOFF_8") return {code:"NOT_PLAYOFF" as const};
  if(!bracket.team_a_id || !bracket.team_b_id || bracket.number<1 || bracket.number>7) throw Error("INVALID_SAVED_BRACKET");
  const stage=z.object({kind:z.literal("PLAYOFF_8"),qualifiers:z.array(z.object({teamId:z.uuid(),rank:z.number().int().positive()})).length(8)}).safeParse(bracket.competition_stages.format);
  const parameter=await tx.competition_rule_parameters.findFirst({where:{competition_rule_id:bracket.competition_stages.competition_rule_id,parameter_key:"calendar",requires_validation:false,validated_by:{not:null}},select:{parameter_value:true}});
  const config=z.object({playoff:playoffRulesSchema.extend({regularDeadline:z.iso.date(),dates:z.array(z.iso.date()).optional()})}).safeParse(parameter?.parameter_value);
  if(!stage.success || !config.success) throw Error("PLAYOFF_RULE_REQUIRED");
  const first=stage.data.qualifiers.find(team=>team.teamId===bracket.team_a_id),second=stage.data.qualifiers.find(team=>team.teamId===bracket.team_b_id);
  if(!first || !second) throw Error("PLAYOFF_TEAM_NOT_QUALIFIED");
  const round=bracket.number<=4 ? "QUARTERFINAL" : bracket.number<=6 ? "SEMIFINAL" : "FINAL";
  const format=round==="QUARTERFINAL" ? config.data.playoff.format.quarterfinals : round==="SEMIFINAL" ? config.data.playoff.format.semifinals : config.data.playoff.format.final;
  const legs=bracket.bracket_matches.map(item=>item.matches).filter((m):m is NonNullable<typeof m>=>m!==null).map(m=>({home:m.home_team_id,away:m.away_team_id,homeScore:m.match_results?.home_score??null,awayScore:m.match_results?.away_score??null,matchStatus:m.match_statuses.code,resultSource:m.match_results?.source??null,offendingTeamId:m.match_results?.offending_team_id??null,reportStatus:m.match_reports?.status??null,reportConfirmed:!!m.match_reports?.confirmed_at}));
  const result=resolvePlayoffWinner(first,second,round,format,config.data.playoff.preliminaryTiebreaker,legs);
  if(!result.ok) {
    if(["LEGS_INCOMPLETE","OFFICIAL_RESULTS_INCOMPLETE","PENALTIES_REQUIRED"].includes(result.code)) return {code:result.code};
    throw Error(result.code);
  }
  if(bracket.winner_id && bracket.winner_id!==result.winnerId) throw Error("PLAYOFF_WINNER_CONFLICT");
  if(!bracket.winner_id) await tx.brackets.update({where:{id:bracket.id},data:{winner_id:result.winnerId}});
  if(bracket.next_bracket_id && (bracket.next_slot===1 || bracket.next_slot===2)) {
    await tx.$queryRaw`SELECT id FROM sports_management.brackets WHERE id=${bracket.next_bracket_id}::uuid FOR UPDATE`;
    const next=await tx.brackets.findUniqueOrThrow({where:{id:bracket.next_bracket_id},select:{team_a_id:true,team_b_id:true}});
    const current=bracket.next_slot===1?next.team_a_id:next.team_b_id;
    if(current && current!==result.winnerId) throw Error("PLAYOFF_NEXT_SLOT_CONFLICT");
    if(!current) await tx.brackets.update({where:{id:bracket.next_bracket_id},data:bracket.next_slot===1?{team_a_id:result.winnerId}:{team_b_id:result.winnerId}});
  }
  return {code:"ADVANCED" as const,winnerId:result.winnerId};
}
