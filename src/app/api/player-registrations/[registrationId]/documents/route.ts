import {readPlayerDossierForActor} from "@/features/players/server/document-queries";
import {documentActor,documentFailure,documentHeaders} from "@/features/players/server/document-http";
export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{registrationId:string}>}){try{const actor=await documentActor(request);return Response.json(await readPlayerDossierForActor(actor.id,(await context.params).registrationId),{headers:documentHeaders});}catch(error){return documentFailure(error);}}
