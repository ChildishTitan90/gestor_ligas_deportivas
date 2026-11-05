import {z} from "zod";
import {documentActor,documentBody,documentHeaders,documentFailure} from "@/features/players/server/document-http";
import {activateVerifiedAdultForActor} from "@/features/players/server/automatic-activation";
import {readPlayerCurpStatusForActor} from "@/features/players/server/curp-verification-service";
export async function POST(request:Request,context:{params:Promise<{registrationId:string}>}){
  try{
    const actor=await documentActor(request,true),{registrationId}=await context.params;
    if(!z.uuid().safeParse(registrationId).success || !z.strictObject({}).safeParse(await documentBody(request)).success)return Response.json({code:"INVALID_PAYLOAD"},{status:400,headers:documentHeaders});
    await activateVerifiedAdultForActor(actor.id,registrationId);
    return Response.json(await readPlayerCurpStatusForActor(actor.id,registrationId),{headers:documentHeaders});
  }catch(error){return documentFailure(error);}
}
