import {approvePlayerOriginForActor} from "@/features/players/server/origin-approval";
import {categoryParticipationFailure} from "@/features/players/server/category-participation-http";
import {documentActor,documentBody,documentHeaders} from "@/features/players/server/document-http";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{registrationId:string}>}){
  try{const actor=await documentActor(request,true);return Response.json(await approvePlayerOriginForActor(actor.id,(await params).registrationId,await documentBody(request)),{headers:documentHeaders});}
  catch(error){return categoryParticipationFailure(error);}
}
