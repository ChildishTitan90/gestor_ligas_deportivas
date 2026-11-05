import {z} from "zod";
import {playerRequest,PlayerRequestError} from "./player-client";

/** Estado en memoria. El llamador conserva la misma instancia ante una respuesta incierta. */
export type PendingDocumentUpload={body:unknown;bytes:Uint8Array;mimeType:string;uploadId?:string;uploadPath?:string;step:"PREPARE"|"UPLOAD"|"CONFIRM"};
export async function sendPlayerDocumentOperation(actorId:string,operation:PendingDocumentUpload,fetcher:typeof fetch=fetch){
  if(operation.step==="PREPARE"){
    const result=z.object({uploadId:z.uuid(),uploadPath:z.string()}).safeParse(await playerRequest(actorId,"/api/player-documents/uploads",operation.body,fetcher));
    if(!result.success)throw new PlayerRequestError("UNCONFIRMED",true);
    const path=`/api/player-documents/uploads/${result.data.uploadId}`;
    if(result.data.uploadPath!==path)throw new PlayerRequestError("UNCONFIRMED",true);
    operation.uploadId=result.data.uploadId;operation.uploadPath=path;operation.step="UPLOAD";
  }
  if(operation.step==="UPLOAD"){
    try{
      const response=await fetcher(operation.uploadPath!,{method:"PUT",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":operation.mimeType,"X-Expected-Actor-Id":actorId},body:new Blob([new Uint8Array(operation.bytes)]),signal:AbortSignal.timeout(60000)});
      const data=await response.json();
      if(!response.ok)throw new PlayerRequestError(typeof data?.code==="string"?data.code:"UNCONFIRMED",response.status>=500);
      if(data?.stored!==true)throw new PlayerRequestError("UNCONFIRMED",true);
      operation.step="CONFIRM";
    }catch(error){if(error instanceof PlayerRequestError)throw error;throw new PlayerRequestError("UNCONFIRMED",true);}
  }
  const result=z.object({documentId:z.uuid()}).safeParse(await playerRequest(actorId,`${operation.uploadPath}/confirm`,{},fetcher));
  if(!result.success)throw new PlayerRequestError("UNCONFIRMED",true);
  return result.data;
}
