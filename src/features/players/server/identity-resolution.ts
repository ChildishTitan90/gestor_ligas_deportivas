import "server-only";
import {createHash} from "node:crypto";
import type {Prisma} from "@prisma/client";

export async function hasCurrentIdentityResolution(tx:Prisma.TransactionClient,id:string,personId:string,matches:string[]) {
  const rows=await tx.people.findMany({where:{id:{in:[personId,...matches]}},select:{id:true,identity_version:true},orderBy:{id:"asc"}});
  const hash=createHash("sha256").update(JSON.stringify(rows.map(p=>[p.id,p.identity_version]))).digest("hex");
  const last=await tx.audit_logs.findFirst({where:{entity_id:id,action:"PLAYER_IDENTITY_REVIEWED"},orderBy:[{occurred_at:"desc"},{id:"desc"}],select:{new_data:true}});
  const data=last?.new_data as {identityFingerprint?:string;decision?:string}|undefined;
  return data?.identityFingerprint === hash && data.decision === "DISTINCT_IDENTITIES_CONFIRMED";
}
