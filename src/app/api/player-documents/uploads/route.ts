import {preparePlayerDocumentForActor} from "@/features/players/server/document-service";
import {getPlayerDocumentPolicy} from "@/features/players/server/document-policy";
import {documentActor,documentBody,documentFailure,documentHeaders} from "@/features/players/server/document-http";
import {z} from "zod";
export const runtime="nodejs";
export async function POST(request:Request){try{
  const actor=await documentActor(request,true);
  const body=await documentBody(request);
  const id=z.object({registrationId:z.uuid()}).safeParse(body).data?.registrationId;
  const result=await preparePlayerDocumentForActor(actor.id,body,await getPlayerDocumentPolicy(id));
  return Response.json({...result,storageConfigured:Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_STORAGE_SERVER_KEY && process.env.SUPABASE_PLAYER_DOCUMENTS_BUCKET==="expedientes-jugadores"),uploadPath:`/api/player-documents/uploads/${result.uploadId}`},{headers:documentHeaders});
}catch(error){return documentFailure(error);}}
