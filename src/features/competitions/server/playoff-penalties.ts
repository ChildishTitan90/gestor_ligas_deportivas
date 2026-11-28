import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { advancePlayoffResultInTransaction } from "./playoff-advance";

const commandSchema = z.strictObject({ seasonId:z.uuid(), bracketId:z.uuid(), operationId:z.uuid(), firstScore:z.number().int().min(0).max(100), secondScore:z.number().int().min(0).max(100), reason:z.string().trim().min(8).max(500) }).refine(value=>value.firstScore!==value.secondScore);

/** El tanteo es independiente del marcador de juego y se conserva en auditoría. */
export async function confirmPlayoffPenalties(input: unknown) {
  const actor=await requireOperationalUser();
  return confirmPlayoffPenaltiesForActor(actor.id,input);
}

/** Actor interno procedente de sesión o de una prueba aislada. */
export async function confirmPlayoffPenaltiesForActor(actorId:string,input:unknown) {
  const command=commandSchema.parse(input);
  const hash=createHash("sha256").update(JSON.stringify({actorId,...command})).digest("hex");
  return getPrisma().$transaction(async tx=>{
    await lockAuthorization(tx);
    await assertPermission(tx,actorId,{module:"competitions",action:"APPROVE",context:{seasonId:command.seasonId}});
    const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM sports_management.brackets WHERE id=${command.bracketId}::uuid AND season_id=${command.seasonId}::uuid FOR UPDATE`;
    if(!rows.length) throw Error("INVALID_PLAYOFF_BRACKET");
    const prior=await tx.audit_logs.findUnique({where:{id:command.operationId},select:{action:true,user_id:true,entity_id:true,new_data:true}});
    if(prior) {
      const data=prior.new_data as {hash?:string;winnerId?:string}|null;
      if(prior.action!=="PLAYOFF_PENALTIES_CONFIRMED" || prior.user_id!==actorId || prior.entity_id!==command.bracketId || data?.hash!==hash || !data.winnerId) throw Error("OPERATION_KEY_REUSED");
      return {winnerId:data.winnerId,replayed:true};
    }
    const bracket=await tx.brackets.findUniqueOrThrow({where:{id:command.bracketId},select:{team_a_id:true,team_b_id:true,winner_id:true,next_bracket_id:true,next_slot:true,bracket_matches:{orderBy:{leg_number:"desc"},select:{match_id:true},take:1}}});
    if(!bracket.team_a_id || !bracket.team_b_id || bracket.winner_id || !bracket.bracket_matches[0]?.match_id) throw Error("PENALTIES_NOT_AVAILABLE");
    const status=await advancePlayoffResultInTransaction(tx,bracket.bracket_matches[0].match_id);
    if(status.code!=="PENALTIES_REQUIRED") throw Error("PENALTIES_NOT_REQUIRED");
    const winnerId=command.firstScore>command.secondScore?bracket.team_a_id:bracket.team_b_id;
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${command.reason},true)`;
    await tx.audit_logs.create({data:{id:command.operationId,user_id:actorId,action:"PLAYOFF_PENALTIES_CONFIRMED",table_name:"brackets",entity_id:command.bracketId,reason:command.reason,new_data:{hash,firstTeam:bracket.team_a_id,secondTeam:bracket.team_b_id,firstScore:command.firstScore,secondScore:command.secondScore,winnerId}}});
    await tx.brackets.update({where:{id:command.bracketId},data:{winner_id:winnerId}});
    if(bracket.next_bracket_id && (bracket.next_slot===1 || bracket.next_slot===2)) {
      await tx.$queryRaw`SELECT id FROM sports_management.brackets WHERE id=${bracket.next_bracket_id}::uuid FOR UPDATE`;
      const next=await tx.brackets.findUniqueOrThrow({where:{id:bracket.next_bracket_id},select:{team_a_id:true,team_b_id:true}});
      const current=bracket.next_slot===1?next.team_a_id:next.team_b_id;
      if(current && current!==winnerId) throw Error("PLAYOFF_NEXT_SLOT_CONFLICT");
      if(!current) await tx.brackets.update({where:{id:bracket.next_bracket_id},data:bracket.next_slot===1?{team_a_id:winnerId}:{team_b_id:winnerId}});
    }
    return {winnerId,replayed:false};
  },{isolationLevel:"Serializable",timeout:30000});
}
