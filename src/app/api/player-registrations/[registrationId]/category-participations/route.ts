import {documentActor,documentBody,documentHeaders} from "@/features/players/server/document-http";
import {createCategoryParticipationForActor,readCategoryParticipationsForActor} from "@/features/players/server/category-participations";
import {categoryParticipationFailure} from "@/features/players/server/category-participation-http";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{registrationId:string}>}){
  try{const actor=await documentActor(request);return Response.json(await readCategoryParticipationsForActor(actor.id,(await context.params).registrationId),{headers:documentHeaders});}
  catch(error){return categoryParticipationFailure(error);}
}
export async function POST(request:Request,context:{params:Promise<{registrationId:string}>}){
  try{const actor=await documentActor(request,true);return Response.json(await createCategoryParticipationForActor(actor.id,(await context.params).registrationId,await documentBody(request)),{headers:documentHeaders});}
  catch(error){return categoryParticipationFailure(error);}
}
