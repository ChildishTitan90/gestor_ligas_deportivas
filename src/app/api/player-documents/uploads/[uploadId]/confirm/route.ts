import {z} from "zod";
import {confirmPlayerDocumentForActor,PlayerDocumentError} from "@/features/players/server/document-service";
import {getPlayerDocumentUploadPolicy} from "@/features/players/server/document-policy";
import {createSupabasePlayerDocumentStorage} from "@/features/players/server/supabase-document-storage";
import {documentActor,documentBody,documentFailure,documentHeaders} from "@/features/players/server/document-http";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{uploadId:string}>}){try{
  const actor=await documentActor(request,true);if(!z.strictObject({}).safeParse(await documentBody(request)).success)throw new PlayerDocumentError("INVALID_DOCUMENT",400);
  const id=(await context.params).uploadId;
  return Response.json(await confirmPlayerDocumentForActor(actor.id,id,createSupabasePlayerDocumentStorage(),await getPlayerDocumentUploadPolicy(actor.id,id)),{headers:documentHeaders});
}catch(error){return documentFailure(error);}}
