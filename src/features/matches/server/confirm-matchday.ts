import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { MatchTransitionError } from "../transition-rules";
import { getRecorderWorkspaceInTransaction } from "./recorder-workspace";
import { transitionMatchInTransaction } from "./transition";
import type { PrismaClient } from "@prisma/client";

const schema=z.strictObject({matchdayId:z.uuid(),operationId:z.uuid(),reason:z.string().trim().min(5).max(500)});
function matchOperation(batch:string,matchId:string) {
  const bytes=createHash("sha256").update(`confirm-matchday:${batch}:${matchId}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|0x50;bytes[8]=(bytes[8]&63)|0x80;
  const hex=bytes.toString("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function confirmMatchday(raw:unknown) {
  const actor=await requireOperationalUser();
  return confirmMatchdayForActor(actor.id,raw);
}
export async function confirmMatchdayForActor(actorId:string,raw:unknown,db:PrismaClient=getPrisma()) {
  const input=schema.parse(raw);
  const items=await db.$transaction(async tx=>{
    const result:Awaited<ReturnType<typeof getRecorderWorkspaceInTransaction>>["items"]=[];
    let after:string|undefined;
    do {
      const page=await getRecorderWorkspaceInTransaction(tx,actorId,after,input.matchdayId);
      if(!page.matchdays.find(day=>day.id===input.matchdayId)?.canConfirm)throw new AuthorizationError();
      result.push(...page.items);after=page.nextAfter??undefined;
    } while(after);
    return result;
  },{timeout:30000});
  const confirmed:{name:string;replayed:boolean}[]=[], pending:{name:string;code:string}[]=[], already:{name:string}[]=[];
  for(const match of items) {
    const name=`${match.homeTeam} vs. ${match.awayTeam}`;
    if(match.status==="CONFIRMED") {already.push({name});continue;}
    if(!["SCHEDULED","RESCHEDULED"].includes(match.status) || !match.canSchedule) {pending.push({name,code:"STATE_NOT_READY"});continue;}
    try {
      const receipt=await db.$transaction(tx=>transitionMatchInTransaction(tx,actorId,{matchId:match.id,expectedVersion:match.version,
        operationId:matchOperation(input.operationId,match.id),toStatus:"CONFIRMED",reason:input.reason}),{timeout:15000});
      confirmed.push({name,replayed:receipt.replayed});
    } catch(error) {
      if(error instanceof MatchTransitionError || error instanceof AuthorizationError) pending.push({name,code:error.code});
      else throw error;
    }
  }
  return {confirmed,pending,already};
}
