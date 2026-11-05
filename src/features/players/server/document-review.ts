import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import type {Prisma} from "@prisma/client";
import {getPrisma} from "@/server/db/prisma";
import {AuthorizationError,getPermissionGrants} from "@/server/auth/authorization";
import {requireOperationalUser} from "@/server/auth/session";
import {assertPlayerRegistrationRead,lockPlayerTeamContext} from "./access";
import {PlayerDocumentError} from "./document-service";
import {documentReviewSchema} from "../document-review";
import {readRegistrationLabels} from "./registration-labels";
import {activateVerifiedAdultForActor} from "./automatic-activation";
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function snapshot(tx:Prisma.TransactionClient,actorId:string,id:string){
  if(!z.uuid().safeParse(id).success)throw new AuthorizationError();
  const reg=await tx.player_registrations.findUnique({where:{id},select:{season_team_id:true}});
  if(!reg)throw new AuthorizationError();
  const context=await assertPlayerRegistrationRead(tx,actorId,id,reg.season_team_id);
  await lockPlayerTeamContext(tx,actorId,reg.season_team_id,"APPROVE");
  if(context.seasonStatus==="CLOSED" || context.teamStatus==="WITHDRAWN" || context.affiliationStatus!=="APPROVED" || (!context.categoryAuthorized || !context.operational))throw new PlayerDocumentError("CONTEXT_UNAVAILABLE");
  await tx.$queryRaw`SELECT id FROM sports_management.player_registrations WHERE id=${id}::uuid FOR UPDATE`;
  const current=await tx.player_registrations.findUniqueOrThrow({where:{id},select:{status:true,withdrawn_at:true,registered_at:true,people:{select:{identity_version:true}}}});
  if(current.withdrawn_at || !["INELIGIBLE","ACTIVE"].includes(current.status))throw new PlayerDocumentError("CONTEXT_UNAVAILABLE");
  const events=await tx.audit_logs.findMany({where:{entity_id:id,action:"PLAYER_DOCUMENT_CONFIRMED"},select:{new_data:true}});
  const revisions=events.map(e=>e.new_data as {documentId:string;replacesDocumentId:string|null;identityVersion:number});
  const replaced=new Set(revisions.map(r=>r.replacesDocumentId));
  const ids=revisions.filter(r=>r.identityVersion===current.people.identity_version && !replaced.has(r.documentId)).map(r=>r.documentId);
  const documents=await tx.player_documents.findMany({where:{registration_id:id,id:{in:ids}},select:{id:true,status:true,file_id:true,document_types:{select:{code:true,name:true}},files:{select:{sha256:true}}},orderBy:{id:"asc"}});
  const fingerprint=hash([current,documents]);
  return {documents,fingerprint,identityVersion:current.people.identity_version};
}
export async function readDocumentReviewForActor(actorId:string,id:string){
  return getPrisma().$transaction(async tx=>{
    const state=await snapshot(tx,actorId,id);
    const reviews=await tx.audit_logs.findMany({where:{entity_id:id,action:"PLAYER_DOCUMENT_REVIEWED"},select:{occurred_at:true,reason:true,new_data:true},orderBy:[{occurred_at:"desc"},{id:"desc"}]});
    return {registrationId:id,player:await readRegistrationLabels(tx,id),fingerprint:state.fingerprint,documents:state.documents.map(d=>({id:d.id,code:d.document_types.code,name:d.document_types.name,status:d.status})),history:reviews.map(r=>({date:r.occurred_at.toISOString(),reason:r.reason,decision:(r.new_data as {decision:string}).decision}))};
  });
}
export async function decideDocumentReviewForActor(actorId:string,id:string,input:unknown){
  const parsed=documentReviewSchema.safeParse(input);if(!parsed.success)throw new PlayerDocumentError("INVALID_DOCUMENT",400);
  const body=parsed.data;
  const h=hash(["document-review:v1",actorId,body.operationKey]);
  const operationId=`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
  const result=await getPrisma().$transaction(async tx=>{
    const state=await snapshot(tx,actorId,id);
    const prior=await tx.audit_logs.findUnique({where:{id:operationId},select:{entity_id:true,new_data:true}});
    if(prior){if(prior.entity_id!==id || (prior.new_data as {requestHash:string}).requestHash!==hash(body))throw new PlayerDocumentError("UPLOAD_CONFLICT");return {confirmed:true,replayed:true};}
    if(state.fingerprint!==body.fingerprint)throw new PlayerDocumentError("UPLOAD_CONFLICT");
    const doc=state.documents.find(d=>d.id===body.documentId);if(!doc)throw new PlayerDocumentError("UPLOAD_CONFLICT");
    const guardian=doc.document_types.code==="GUARDIAN_CONSENT";
    if(guardian && body.decision==="APPROVE" && (!body.identityChecked || !body.relationshipChecked || !body.signatureChecked || !body.authorizationChecked || !body.guardianName || !body.relationship))throw new PlayerDocumentError("INVALID_DOCUMENT",400);
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${body.reason},true)`;
    await tx.player_documents.update({where:{id:doc.id},data:{status:body.decision==="APPROVE"?"VALIDATED":"REJECTED",reviewed_by:actorId}});
    await tx.audit_logs.create({data:{id:operationId,user_id:actorId,action:"PLAYER_DOCUMENT_REVIEWED",table_name:"player_documents",entity_id:id,reason:body.reason,new_data:{requestHash:hash(body),documentId:doc.id,fileId:doc.file_id,identityVersion:state.identityVersion,decision:body.decision,guardianAccredited:guardian && body.decision==="APPROVE",...(guardian?{relationship:body.relationship ?? null,checks:{identity:body.identityChecked,relationship:body.relationshipChecked,signature:body.signatureChecked,authorization:body.authorizationChecked}}:{})}}});
    return {confirmed:true,replayed:false};
  },{timeout:15000});
  // La revisión ya tiene acuse. Reintentar la misma decisión recupera también
  // esta evaluación local; nunca vuelve a consultar un proveedor.
  if(body.decision==="APPROVE")await activateVerifiedAdultForActor(actorId,id,"APPROVE");
  return result;
}
export async function getDocumentReviewQueue(){
  const actor=await requireOperationalUser();
  return readDocumentReviewQueueForActor(actor.id);
}
export async function readDocumentReviewQueueForActor(actorId:string){
  const grants=await getPrisma().$transaction(tx=>getPermissionGrants(tx,actorId,"players","APPROVE"));
  if(!grants.length)throw new AuthorizationError();
  const scopes:Prisma.clubsWhereInput[]=grants.flatMap(g=>g.clubId?[{id:g.clubId,...(g.leagueId?{league_id:g.leagueId}:{})}]:g.leagueId?[{league_id:g.leagueId}]:g.contextOnly?[]:[{}]);
  const rows=await getPrisma().player_registrations.findMany({where:{status:{in:["INELIGIBLE","ACTIVE"]},season_teams:{teams:{clubs:{OR:scopes}}},player_documents:{some:{status:"PENDING"}}},select:{id:true},orderBy:{id:"asc"}});
  const result=[];
  for(const row of rows){try{const data=await readDocumentReviewForActor(actorId,row.id);const pending=data.documents.filter(d=>d.status==="PENDING");if(pending.length)result.push({...data.player,pendingCount:pending.length,guardianPending:pending.some(d=>d.code==="GUARDIAN_CONSENT")});}catch(error){if(!(error instanceof AuthorizationError) && !(error instanceof PlayerDocumentError))throw error;}}
  return result;
}
