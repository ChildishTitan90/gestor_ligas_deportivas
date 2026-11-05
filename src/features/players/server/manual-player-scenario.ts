import "server-only";
import type {Prisma} from "@prisma/client";

/** Capability of an isolated manual fixture, never a browser flag or habitual DB. */
export function isManualPlayerDatabase(environment:NodeJS.ProcessEnv){
  if(environment.NODE_ENV!=="development" || environment.PLAYER_MANUAL_SCENARIOS!=="1")return false;
  let url:URL;try{url=new URL(environment.DATABASE_URL ?? "");}catch{return false;}
  return ["postgres:","postgresql:"].includes(url.protocol) && ["127.0.0.1","localhost","[::1]"].includes(url.hostname) && ["5432","5433"].includes(url.port || "5432") && /^\/pdgld48_test_[a-f0-9]{16}$/.test(url.pathname) && !url.search && !url.hash;
}
export async function manualPlayerScenario(tx:Prisma.TransactionClient,seasonTeamId:string):Promise<"MINOR_FLOW"|"VETERAN_FLOW"|null>{
  if(!isManualPlayerDatabase(process.env))return null;
  const marker=await tx.audit_logs.findFirst({where:{entity_id:seasonTeamId,table_name:"season_teams",action:"MANUAL_PLAYER_SCENARIO"},select:{new_data:true}});
  const mode=(marker?.new_data as {mode?:string}|null)?.mode;
  return mode==="MINOR_FLOW" || mode==="VETERAN_FLOW"?mode:null;
}
