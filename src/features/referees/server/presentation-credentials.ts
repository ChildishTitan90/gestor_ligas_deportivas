import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {getPrisma} from "@/server/db/prisma";
import {AuthorizationError} from "@/server/auth/authorization";
import {PRIVATE_FILE_MAX_BYTES,validatePrivateFileContent} from "@/server/files/private-file-validation";
import type {PrivateDocumentTransport} from "@/server/files/private-document-storage";
import {presentationMutation} from "../presentation-contract";
import {mutatePresentationInTransaction,requestById,submitAccess,reviewAccess} from "./presentations";
import {lockRefereeing,RefereeError,type Receipt} from "./service";

const digest=(input:unknown)=>createHash("sha256").update(JSON.stringify(input)).digest("hex");
function uploadId(actorId:string,key:string){const h=digest(["referee-credential:v1",actorId,key]);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
/** Storage queda fuera de las transacciones. La vinculación definitiva vuelve a autorizar. */
export async function mutatePresentationWithCredential(actorId:string,input:unknown,attachment:{bytes:Uint8Array;mimeType:string},storage:PrivateDocumentTransport):Promise<Receipt>{
  const parsed=presentationMutation.safeParse(input);
  if(!parsed.success||!["submit","credential"].includes(parsed.data.kind))throw new RefereeError("INVALID_PAYLOAD",400);
  const command=parsed.data;
  if(command.kind!=="submit"&&command.kind!=="credential")throw new RefereeError("INVALID_PAYLOAD",400);
  if(!command.credential)throw new RefereeError("CREDENTIAL_REQUIRED",400);
  const hash=digest(command),fileId=uploadId(actorId,command.operationKey),db=getPrisma();
  const prepared=await db.$transaction<{receipt:Receipt;objectKey?:never}|{receipt?:never;objectKey:string}>(async tx=>{
    await lockRefereeing(tx);
    let clubId:string,seasonId:string,leagueId:string;
    if(command.kind==="submit"){clubId=command.clubId;seasonId=command.seasonId;leagueId=(await submitAccess(tx,actorId,clubId,seasonId)).league_id;}
    else{const p=await requestById(tx,command.presentationId);clubId=p.club_id;seasonId=p.season_id;leagueId=(await submitAccess(tx,actorId,clubId,seasonId)).league_id;}
    const prior=command.kind==="submit"?await tx.referee_presentations.findFirst({where:{requester_id:actorId,operation_key:command.operationKey},select:{id:true}}):await tx.referee_presentation_credentials.findFirst({where:{uploaded_by:actorId,operation_key:command.operationKey},select:{id:true}});
    if(prior)return {receipt:await mutatePresentationInTransaction(tx,actorId,command)};
    const period=await tx.seasons.findUniqueOrThrow({where:{id:seasonId},select:{status:true}});if(period.status==="CLOSED")throw new RefereeError("CLOSED_CONTEXT");
    if(command.kind==="credential"){const p=await requestById(tx,command.presentationId);if(p.status!=="PENDING"||p.version!==command.expectedVersion)throw new RefereeError("STALE_VERSION");if(await tx.referee_presentation_credentials.findUnique({where:{id:p.id},select:{id:true}}))throw new RefereeError("CREDENTIAL_CONFLICT");}
    const objectKey=`referee-credentials/v1/${leagueId}/${seasonId}/${clubId}/${actorId}/${command.operationKey}`;
    const priorIntent=await tx.audit_logs.findUnique({where:{id:fileId},select:{user_id:true,action:true,new_data:true}});
    if(priorIntent){if(priorIntent.user_id!==actorId||priorIntent.action!=="REFEREE_CREDENTIAL_PREPARED"||(priorIntent.new_data as {inputHash?:string})?.inputHash!==hash)throw new RefereeError("OPERATION_KEY_REUSED");}
    else await tx.audit_logs.create({data:{id:fileId,user_id:actorId,action:"REFEREE_CREDENTIAL_PREPARED",table_name:"referee_presentation_credentials",entity_id:clubId,reason:"Preparación privada de acreditación arbitral",new_data:{inputHash:hash,objectKey,...command.credential}}});
    return {objectKey};
  },{timeout:20000});
  if(prepared.receipt)return prepared.receipt;
  const file=await validatePrivateFileContent(attachment.bytes,attachment.mimeType),meta=command.credential;
  if(file.sha256!==meta.sha256||file.sizeBytes!==meta.sizeBytes||file.mimeType!==meta.mimeType)throw new RefereeError("CREDENTIAL_CONFLICT",400);
  await storage.put(prepared.objectKey,file);
  const confirmed=await storage.read(prepared.objectKey,PRIVATE_FILE_MAX_BYTES,file.mimeType);
  if(confirmed.byteLength!==file.sizeBytes||createHash("sha256").update(confirmed).digest("hex")!==file.sha256)throw new RefereeError("CREDENTIAL_CONFLICT");
  return db.$transaction(tx=>mutatePresentationInTransaction(tx,actorId,command,{...meta,fileId,objectKey:prepared.objectKey}),{timeout:20000});
}

export async function readCredentialForActor(actorId:string,presentationId:string){
  if(!z.uuid().safeParse(presentationId).success)throw new AuthorizationError();
  return getPrisma().$transaction(async tx=>{
    const row=await tx.referee_presentations.findUnique({where:{id:presentationId},select:{club_id:true,season_id:true}});if(!row)throw new AuthorizationError();
    try{await reviewAccess(tx,actorId,row);}catch(e){if(!(e instanceof AuthorizationError))throw e;await submitAccess(tx,actorId,row.club_id,row.season_id);}
    const c=await tx.referee_presentation_credentials.findUnique({where:{id:presentationId},select:{file:{select:{id:true,storage_key:true,mime_type:true,sha256:true,size_bytes:true}}}});if(!c)throw new RefereeError("CREDENTIAL_REQUIRED",404);return c.file;
  },{timeout:20000});
}
export async function createCredentialPreview(actorId:string,presentationId:string,storage:PrivateDocumentTransport){
  const file=await readCredentialForActor(actorId,presentationId);
  const bytes=await storage.read(file.storage_key,PRIVATE_FILE_MAX_BYTES,file.mime_type);
  if(BigInt(bytes.byteLength)!==file.size_bytes||createHash("sha256").update(bytes).digest("hex")!==file.sha256)throw new RefereeError("CREDENTIAL_CONFLICT");
  const access=await storage.createDownloadUrl(file.storage_key);
  const current=await readCredentialForActor(actorId,presentationId);if(current.id!==file.id||current.sha256!==file.sha256)throw new AuthorizationError();
  return {...access,mimeType:file.mime_type};
}
