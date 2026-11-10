import {reviewCategoryParticipationForActor} from "@/features/players/server/category-participations";
import {categoryParticipationFailure} from "@/features/players/server/category-participation-http";
import {documentActor,documentBody,documentHeaders} from "@/features/players/server/document-http";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{participationId:string}>}){
  try{const actor=await documentActor(request,true);return Response.json(await reviewCategoryParticipationForActor(actor.id,(await params).participationId,await documentBody(request)),{headers:documentHeaders});}
  catch(error){return categoryParticipationFailure(error);}
}
