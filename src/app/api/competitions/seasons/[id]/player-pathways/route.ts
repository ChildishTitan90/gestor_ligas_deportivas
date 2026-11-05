import {documentActor,documentBody,documentHeaders} from "@/features/players/server/document-http";
import {configurePlayerPathwayForActor,readPlayerPathwayForActor} from "@/features/players/server/category-participations";
import {categoryParticipationFailure} from "@/features/players/server/category-participation-http";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  try{const actor=await documentActor(request);return Response.json(await readPlayerPathwayForActor(actor.id,(await context.params).id),{headers:documentHeaders});}
  catch(error){return categoryParticipationFailure(error);}
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{const actor=await documentActor(request,true);return Response.json(await configurePlayerPathwayForActor(actor.id,(await context.params).id,await documentBody(request)),{headers:documentHeaders});}
  catch(error){return categoryParticipationFailure(error);}
}
