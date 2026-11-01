import {z} from "zod";
import {createPlayerDocumentDownloadForActor} from "@/features/players/server/document-download";
import {PlayerDocumentError} from "@/features/players/server/document-service";
import {createSupabasePlayerDocumentStorage} from "@/features/players/server/supabase-document-storage";
import {documentActor,documentBody,documentFailure,documentHeaders} from "@/features/players/server/document-http";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{documentId:string}>}){try{
  const actor=await documentActor(request,true);if(!z.strictObject({}).safeParse(await documentBody(request)).success)throw new PlayerDocumentError("INVALID_DOCUMENT",400);
  return Response.json(await createPlayerDocumentDownloadForActor(actor.id,(await context.params).documentId,createSupabasePlayerDocumentStorage()),{headers:documentHeaders});
}catch(error){return documentFailure(error);}}
