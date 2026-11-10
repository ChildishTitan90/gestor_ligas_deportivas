import "server-only";
import {z} from "zod";
import {createHash} from "node:crypto";
import {getPrisma} from "@/server/db/prisma";
import {AuthorizationError} from "@/server/auth/authorization";
import {assertPlayerRegistrationRead} from "./access";
import {PlayerDocumentError} from "./document-service";
import type {PlayerDocumentTransport} from "./document-storage";
import {PRIVATE_FILE_MAX_BYTES} from "@/server/files/private-file-validation";

export async function createPlayerDocumentDownloadForActor(actorId:string,documentId:string,storage:PlayerDocumentTransport){
  if(!z.uuid().safeParse(documentId).success)throw new AuthorizationError();
  const authorize=()=>getPrisma().$transaction(async tx=>{
    const doc=await tx.player_documents.findUnique({where:{id:documentId},select:{registration_id:true,player_registrations:{select:{season_team_id:true}},files:{select:{id:true,storage_key:true,sha256:true,size_bytes:true,mime_type:true}}}});
    if(!doc)throw new AuthorizationError();
    await assertPlayerRegistrationRead(tx,actorId,doc.registration_id,doc.player_registrations.season_team_id);
    const receipt=await tx.audit_logs.findFirst({where:{entity_id:doc.registration_id,action:"PLAYER_DOCUMENT_CONFIRMED",new_data:{path:["documentId"],equals:documentId}},select:{new_data:true}});
    if(!receipt || (receipt.new_data as {fileId?:string}).fileId!==doc.files.id || !doc.files.sha256)throw new AuthorizationError();
    return doc.files;
  });
  const file=await authorize();
  const bytes=await storage.read(file.storage_key,PRIVATE_FILE_MAX_BYTES,file.mime_type);
  if(BigInt(bytes.byteLength)!==file.size_bytes || createHash("sha256").update(bytes).digest("hex")!==file.sha256)throw new PlayerDocumentError("UPLOAD_CONFLICT");
  const result=await storage.createDownloadUrl(file.storage_key);
  const current=await authorize();if(current.id!==file.id || current.storage_key!==file.storage_key || current.sha256!==file.sha256)throw new AuthorizationError();
  return {...result,mimeType:file.mime_type};
}
