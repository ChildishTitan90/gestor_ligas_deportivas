import "server-only";
import {RefereeError} from "./service";
import {PRIVATE_FILE_MAX_BYTES} from "@/server/files/private-file-validation";
/** Límite comprobado antes de parsear multipart; el MIME real se valida en servicio. */
export async function readCredentialMultipart(request:Request,actorId:string){
  if(request.headers.get("X-Expected-Actor-Id")!==actorId||request.headers.get("origin")!==new URL(process.env.NEXTAUTH_URL??request.url).origin||request.headers.get("sec-fetch-site")==="cross-site")throw new RefereeError("FORBIDDEN",403);
  const contentType=request.headers.get("content-type")??"",limit=PRIVATE_FILE_MAX_BYTES+32768;
  if(!contentType.startsWith("multipart/form-data;"))throw new RefereeError("INVALID_PAYLOAD",400);
  if(Number(request.headers.get("content-length")??0)>limit)throw new RefereeError("FILE_TOO_LARGE",413);
  const reader=request.body?.getReader();if(!reader)throw new RefereeError("INVALID_PAYLOAD",400);const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw new RefereeError("FILE_TOO_LARGE",413);}chunks.push(value);}}finally{reader.releaseLock();}
  let data:FormData;try{data=await new Response(Buffer.concat(chunks),{headers:{"Content-Type":contentType}}).formData();}catch{throw new RefereeError("INVALID_PAYLOAD",400);}
  const payload=data.get("payload"),file=data.get("credential");
  if([...data.keys()].length!==2||typeof payload!=="string"||payload.length>32768||!(file instanceof File))throw new RefereeError("INVALID_PAYLOAD",400);
  let command:unknown;try{command=JSON.parse(payload);}catch{throw new RefereeError("INVALID_PAYLOAD",400);}
  return {command,attachment:{bytes:new Uint8Array(await file.arrayBuffer()),mimeType:file.type}};
}
