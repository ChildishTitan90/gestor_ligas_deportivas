import {authorizePlayerDocumentUploadForActor,uploadPlayerDocumentForActor,readPlayerDocumentUploadForActor} from "@/features/players/server/document-service";
import {getPlayerDocumentUploadPolicy} from "@/features/players/server/document-policy";
import {createSupabasePlayerDocumentStorage} from "@/features/players/server/supabase-document-storage";
import {documentActor,documentBody,documentFailure,documentHeaders} from "@/features/players/server/document-http";
export const runtime="nodejs";
type Context={params:Promise<{uploadId:string}>};
export async function GET(request:Request,context:Context){try{const actor=await documentActor(request);return Response.json(await readPlayerDocumentUploadForActor(actor.id,(await context.params).uploadId),{headers:documentHeaders});}catch(error){return documentFailure(error);}}
export async function PUT(request:Request,context:Context){try{
  const actor=await documentActor(request,true),id=(await context.params).uploadId,policy=await getPlayerDocumentUploadPolicy(actor.id,id);
  await authorizePlayerDocumentUploadForActor(actor.id,id,policy);
  const bytes=await documentBody(request,true) as Uint8Array;
  return Response.json(await uploadPlayerDocumentForActor(actor.id,id,bytes,request.headers.get("content-type")!.split(";")[0],createSupabasePlayerDocumentStorage(),policy),{headers:documentHeaders});
}catch(error){return documentFailure(error);}}
