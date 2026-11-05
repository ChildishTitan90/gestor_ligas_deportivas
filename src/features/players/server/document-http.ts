import "server-only";
import {requireOperationalUser,AuthAccessError} from "@/server/auth/session";
import {AuthorizationError} from "@/server/auth/authorization";
import {PlayerDocumentError} from "./document-service";
import {PlayerDocumentStorageError} from "./supabase-document-storage";
import {BinaryFileValidationError,PRIVATE_FILE_MAX_BYTES} from "@/server/files/private-file-validation";

export const documentHeaders={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",Vary:"Cookie"};
class DocumentHttpError extends Error {constructor(public code:string,public status:number){super(code);}}
export async function documentActor(request:Request,write=false){
  const actor=await requireOperationalUser();
  const expected=request.headers.get("X-Expected-Actor-Id");if(expected && expected!==actor.id)throw new AuthorizationError();
  if(write && (request.headers.get("origin")!==new URL(process.env.NEXTAUTH_URL ?? request.url).origin || request.headers.get("sec-fetch-site")==="cross-site"))throw new DocumentHttpError("INVALID_ORIGIN",403);
  return actor;
}
export async function documentBody(request:Request,binary=false){
  const mime=request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if(binary?!["application/pdf","image/png","image/jpeg"].includes(mime ?? ""):mime!=="application/json")throw new DocumentHttpError("INVALID_PAYLOAD",400);
  // La revisión admite justificación y nombre Unicode, además de las atestaciones.
  const limit=binary?PRIVATE_FILE_MAX_BYTES:8192;
  const length=request.headers.get("content-length");if(length && Number(length)>limit)throw new DocumentHttpError("PAYLOAD_TOO_LARGE",413);
  const reader=request.body?.getReader();if(!reader)throw new DocumentHttpError("INVALID_PAYLOAD",400);
  let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new DocumentHttpError("PAYLOAD_TOO_LARGE",413);}chunks.push(value);}
    const buffer=Buffer.concat(chunks);if(binary)return buffer;try{return JSON.parse(buffer.toString("utf8")) as unknown;}catch{throw new DocumentHttpError("INVALID_PAYLOAD",400);}
  }finally{reader.releaseLock();}
}
export function documentFailure(error:unknown){
  if(error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof PlayerDocumentError || error instanceof PlayerDocumentStorageError || error instanceof BinaryFileValidationError || error instanceof DocumentHttpError)
    return Response.json({code:error.code},{status:error.status,headers:documentHeaders});
  return Response.json({code:"SERVICE_UNAVAILABLE"},{status:503,headers:documentHeaders});
}
